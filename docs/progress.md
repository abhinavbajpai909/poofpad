# Progress

## Phase 1 — Scaffold ✅ (2026-11-20)

- [x] Repo files: README, LICENSE (MIT), .gitignore, .gitattributes, .editorconfig, prettier, eslint flat config
- [x] Dev dependencies pinned exactly (see package.json); no runtime dependencies yet
- [x] `wrangler.jsonc`: assets (`run_worker_first` for `/api/*`, `/ws/*`, `/p/*`, `/privacy`), `Pad` DO via
      `migrations` v1 `new_sqlite_classes`, observability disabled, no account_id
- [x] Worker: hand-written router; `/p/<padId>` and `/privacy` serve `index.html`; everything else 404
- [x] `Pad` Durable Object class (empty, SQLite-backed)
- [x] Vite client page (dark theme tokens), proxy `/api` + `/ws` to `wrangler dev`
- [x] Vitest with `@cloudflare/vitest-plugin` (`worker` project); routing smoke tests
- [x] Playwright config (Chromium, Firefox, WebKit, Pixel 7, iPhone 14); browsers installed in Phase 7
- [x] `npm run dev` verified on Windows; `npm run check` passes

Decisions recorded:

- `@cloudflare/vitest-pool-workers` is deprecated → `@cloudflare/vitest-plugin`.
- TypeScript pinned to 6.0.3 (typescript-eslint 8.73 supports `<6.1`).
- DO declared with `migrations` (not `exports`, which is irreversible after deploy).
- DO stubs via `env.PAD.getByName(padId)`.
- QR library: `uqr@0.1.3` (added in Phase 5).
- `_headers` only covers static-asset responses; Worker responses get the same headers from `http.ts` (done in Phase 6).

## Phase 2 — Realtime sync, unencrypted ✅ (2026-11-20)

- [x] `ALLOW_TEST_TTL` (Phase 1 note 2): `"vars": { "ALLOW_TEST_TTL": "0" }` in `wrangler.jsonc`, so the generated
      `Env` type always has it and production always gets `"0"`; `.dev.vars` (gitignored) overrides it to `"1"`
      locally; `.dev.vars.example` updated
- [x] Runtime deps pinned: `yjs` 13.6.33, `y-protocols` 1.0.7, `y-codemirror.next` 0.3.6, `codemirror` 6.0.2,
      `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.15
- [x] `src/shared/protocol.ts` (frame, `SYNC_ALL`, `INFO` encode/decode), `codes.ts`, `base64url.ts`;
      `docs/protocol.md` documents encodings and the connection lifecycle
- [x] `POST /api/pads`: TTL whitelist (+15 when `ALLOW_TEST_TTL === "1"`), exact body shape, ≤ 1 KB body,
      random padId + admin token (SHA-256 hex stored), sets the expiry alarm; returns 201
- [x] `GET /ws/<padId>`: 426 without `Upgrade: websocket`, forwarded to the `Pad` DO
- [x] `Pad` DO: tables created on pad creation only (probing an unknown id writes nothing), Hibernation API
      (`acceptWebSocket`, `webSocketMessage/Close/Error`), no in-memory state; `UPDATE` stored as one row and
      relayed; `AWARENESS` relayed only; `SYNC_ALL` on join; `INFO` on join/leave; `expires_at` checked on every
      connect and message; `alarm()` closes sockets with 4001 and `deleteAll()`
- [x] Client: router, `provider.ts` (250 ms update batching, 250 ms awareness throttle, reconnect backoff with
      jitter, offline-edit resend by snapshot diff, awareness re-announce on new peer), `editor.ts`
      (CodeMirror + `yCollab`), minimal landing (New pad, 1 h) and pad page (status + peer count)
- [x] Tests: `tests/unit/protocol.test.ts`, `tests/worker/sync.test.ts` (relay, storage, `SYNC_ALL` for late
      joiners, awareness not stored, 4004, bad frames → 1003, 426)
- [x] Smoke test through `npm run dev` (Vite proxy → `wrangler dev` → DO) with two Node Yjs clients and a late
      joiner: converged; `npm run check` passes (42 tests)

Decisions / notes:

- No `attachment` used yet: nothing per-socket is needed until rate limiting (Phase 4).
- Bad frames close with standard `1003`; no custom code exists for that in section 3.3.
- The runtime auto-replies to Close frames (compat date ≥ 2026-04-07), so `webSocketClose` does not call `close()`.
- Expiry alarm and the expiry check are in place because creation needs them; Phase 4 adds End now, limits,
  compaction and their tests (3–7, 9).
- Open question for Phase 4: test 13 needs a 500 KB paste to work, but the max frame is 256 KB and a single Yjs
  update for one paste cannot be split across `UPDATE` frames as-is.

## Phase 3 — Encryption ✅ (2026-11-20)

- [x] `src/client/crypto.ts`: key generation (32 random bytes, base64url), import as non-extractable
      AES-GCM 256 (raw bytes zeroed after import), `encrypt` → `iv(12) || ciphertext+tag` with a fresh
      `getRandomValues` IV, `decrypt` → plaintext or `null`; AES-GCM additional data binds doc vs awareness
- [x] `src/shared/base64url.ts`: strict decoder (rejects padding, `+`/`/`, non-canonical trailing bits).
      Hand-written because `Uint8Array.fromBase64` only became Baseline in Sep 2025 (older iOS Safari lacks it)
- [x] Landing creates the key client-side and opens `/p/<padId>#<key>`; key never sent, stored or logged
- [x] Provider encrypts every outgoing `UPDATE`/`AWARENESS`, decrypts incoming frames in a serial queue
      (order kept across async WebCrypto calls), drops results that belong to a replaced socket
- [x] Key check row + wrong-key rule (see `docs/protocol.md` → Encryption); wrong key → wrong-key screen,
      socket closed, nothing applied, no reconnect
- [x] Missing/malformed `#key` → "This link is incomplete" screen; changing the hash reloads the page
- [x] Tests 1 (`tests/unit/crypto.test.ts`) and 8 (`tests/worker/encryption.test.ts`: marker scanned in all
      DO tables, relayed frames and `SYNC_ALL`; row still decrypts to the original update)
- [x] Browser smoke test (Playwright Chromium against `npm run dev`): two clients sync, no plaintext in any
      WS frame, incomplete/truncated/wrong key screens, others unaffected by a wrong-key client, late joiner
      ok, no console errors. `npm run check` passes (73 tests)

Decisions / notes:

- Deviation from the literal "decrypt failure → wrong key screen": only a failure on the first stored row
  shows it. Applied to every frame, anyone with the padId and a bad key could knock every other client off
  the pad.
- Edge case: if a wrong-key client is the very first to open a brand-new pad (before the creator, who opens
  it immediately), its key check row wins and correct-key clients see "Wrong key".
- `SNAPSHOT` payloads use `encrypt(key, Purpose.Doc, …)`; wired up with compaction in Phase 4.
- On `pagehide` the final flush and awareness clear are now async (WebCrypto), so they are best-effort.
  Unsent edits are still resent from the local doc on the next connect if the tab survives.
- Playwright Chromium was installed into the user cache (`npx playwright install chromium`) for the smoke test.

## Phase 4 — Expiry, End now, limits, compaction ✅ (2026-11-20)

- [x] Max frame raised to 1 MB (decision 1); the limits in `src/shared/limits.ts` and `docs/protocol.md` updated. Checked against
      current DO limits: 8 MB max SQLite row/BLOB, 32 MiB max WS message — fine. 5 MB stored cap kept.
      `SNAPSHOT` frames may be up to 5 MB + 5 bytes (a snapshot can be as large as the pad it replaces)
- [x] Edit size guard (decision 2): `src/client/edit-limit.ts` — CodeMirror `changeFilter` blocks local changes
      whose estimated Yjs update (UTF-8 bytes + per-run overhead) would not fit one frame; the Yjs undo manager's
      undo/redo are checked too (they bypass CM filters). Provider flushes a batch before it would overflow, and
      offline the unsent backlog counts against the budget. Notice shown in the bar
- [x] Undo/redo now go through the Yjs undo manager (`Prec.high` + `yUndoManagerKeymap`). Before, basicSetup's CM
      history handled Ctrl+Z and could undo other people's edits
- [x] Compaction (decision 3): thresholds in `limits.ts`; request goes to the writer of the row that crossed
      the threshold; `upToSeq` stored in that socket's attachment; snapshot accepted once, only from that
      socket; stale snapshots ignored; delete + insert in one `transactionSync`. Snapshot built by
      `src/client/snapshot.ts` with `encrypt(key, Purpose.Doc, …)`
- [x] Quota (decision 4): any failed storage write → `ERROR` 5 + close 4005; `POST /api/pads` → 503; client
      shows the service-busy screen / landing message
- [x] `ERROR` frame (`closeCode − 4000`) sent before every server-initiated 4xxx close; client prefers it
- [x] Limits: 50 peers (4009), 40 msg/s sliding window in the socket attachment (4008), 1 MB frame / 5 MB
      stored (4013), Origin check in the Worker (4003; `localhost:*` only in test mode)
- [x] End now: `POST /api/pads/<id>/end`, Bearer token, `timingSafeEqual` on SHA-256 hex; 204/401/404/503.
      Creator-only "End now" button (with confirm) on the pad page; admin token forgotten after end/expiry
- [x] Expiry: `deleteAll()` first (also deletes the alarm at our compat date), then `ERROR` + 4001 to every
      socket; if deletion fails, sockets still close and the alarm is re-armed for 10 min later
- [x] Close codes mapped to the existing message screen (expired, not found, full, too large, busy)
- [x] Tests 3–7 and 9 (`tests/worker/pads|expiry|compaction|limits.test.ts`), protocol tests for the new
      payloads, `tests/unit/edit-limit.test.ts`. Worker tests set `ALLOW_TEST_TTL=1` via `vitest.config.ts`
      (no longer depend on `.dev.vars`); shared helpers in `tests/worker/helpers.ts`
- [x] Browser smoke test (Chromium, `npm run dev`): 1.5 MB paste blocked with message and other client
      unchanged; real-provider compaction verified in local SQLite (rows 1–3 → 1.2 MB snapshot at seq 3, row 4
      kept); late joiner correct; End now → expired screen on all clients, reload → not found; 15 s pad
      expired on screen at 15.3 s; no console errors

Decisions / notes:

- Compaction byte trigger counts rows after the oldest one, otherwise a pad whose text is itself > 1 MB would
  be asked to compact after every update.
- Stored-bytes totals are an in-memory cache, recomputed from SQLite when missing (hibernation-safe), to avoid
  a full-table scan (rows read) on every update.
- Origin check moved forward from Phase 6 because test 9 needs it; Phase 6 should still review it.
- Known limits: a client holding only the padId (no key) that is asked to compact could submit a garbage
  snapshot; the request only goes to a socket that just wrote a row, but the server cannot verify ciphertext.
  An offline client whose in-flight frame was lost could, on reconnect, need a diff slightly larger than the
  budget it was given (very unlikely). A pad that hits 5 MB closes the writer with 4013; there is no client-side
  pre-check for the 5 MB total.

## Phase 5 — UI ✅ (2026-11-20)

- [x] Landing: New pad, expiry picker (10 min / 1 h / 6 h / 24 h, default 1 h), "Join with link" (`pad-link.ts`
      validates same site, padId and a 32-byte key before navigating), short "Why PoofPad?" blurb
- [x] Pad bar: language picker, theme toggle, people count, connection status, countdown (from the server
      `expiresAt`, so correct after reload), Copy link, Copy all, QR code (uqr, drawn with DOM calls), End now
      (creator only, confirmation dialog), editable display name
- [x] Language shared via `Y.Map("meta")` key `language` (validated against the list); packages loaded with
      dynamic `import()`, one chunk each
- [x] Cursors: random name and colour stored in localStorage (`identity.ts`), published in awareness `user`
- [x] Themes: Dark+ default and a light theme via CSS variables; `public/theme-init.js` (classic script, allowed by
      CSP `script-src 'self'`) sets `data-theme` before first paint; first visit follows `prefers-color-scheme`
- [x] Mobile: all actions in one menu up to 1100 px, 44 px targets, 16 px editor/controls on narrow or touch screens,
      `--app-height` follows `visualViewport` (keyboard), line wrapping, no horizontal scroll
- [x] Screens (one `message.ts` style): expired, not found, pad full, link incomplete, wrong key, service busy;
      offline/reconnecting is a banner above the (still editable) editor
- [x] `/privacy` page (route + `ui/privacy.ts`); no innerHTML anywhere, user text only via textContent
- [x] `tests/unit/pad-link.test.ts`; Chromium smoke test (desktop + 360 px): sync, language sync, theme persists,
      copy, QR, End now, expired on both clients, no console errors

Decisions / notes:

- Added `@lezer/highlight` (pinned) as a direct dependency: the syntax colours need its `tags` and it is already
  installed as a peer of every language package. `@codemirror/legacy-modes` not needed (lang-yaml, lang-xml exist).
- Countdown uses the local clock against the server's `expiresAt`; a badly wrong device clock shifts it.
  (Fixed in Phase 7: `INFO.now` carries the server clock and the countdown corrects for the offset.)

## Phase 6 — Hardening ✅ (2026-11-20)

- [x] Security headers: one set in `SECURITY_HEADERS` (`http.ts`) on every Worker response (pages, API, 404, 405,
      WebSocket 101 accepted or refused); `public/_headers` repeats it for assets the platform serves directly
      (`/`, `/assets/*`, `/theme-init.js`, `/favicon.svg`); `tests/unit/config.test.ts` fails if the two differ
- [x] CSP verified in Chromium, Firefox and WebKit: 0 violations on landing, pad (typing, highlighting, language
      switch, remote cursor, QR dialog, theme toggle, 360 px drawer), `/privacy` and every error screen
- [x] Origin check also on `POST /api/pads` and End now (403); missing Origin is refused; `localhost` only when
      `ALLOW_TEST_TTL === "1"`; `wrangler.jsonc` pins it to "0" and a test fails if that changes
- [x] Validation audit: 405 + `Allow` for wrong methods, 415 for a non-JSON create, fixed error bodies
- [x] No-logging audit and `no-console` lint; cache headers; `npm audit` 0 findings; secrets check
- [x] Worker tests for headers on `/`, `/p/<id>`, `/privacy`, a JS asset, API responses, 404 and WebSocket upgrades

Decisions / notes:

- `style-src 'unsafe-inline'` stays: CodeMirror (style-mod) inserts `<style>` elements, blocked without it
  (verified: 5 `style-src-elem` violations). Style attributes are never used (only CSSOM `.style.x =`, which CSP
  allows), so only the element case needs it. A nonce would need dynamic HTML for `/`, which is static.
- `connect-src 'self'` covers the WebSocket in Chromium, Firefox and WebKit (Playwright builds); no `wss:` added.
  Older Safari releases are reported to not match `'self'` to `ws:`/`wss:`; add `wss://poofpad.com` if a real
  Safari device fails to connect after deploy.
- Removed `interactive-widget` from the viewport meta: WebKit logged it as a console error (test 20) and
  `viewport.ts` already tracks `visualViewport`.
- WebKit logs a (warning-level) cross-origin-isolation note because of the required COOP header; harmless.

## Phase 7 — Full test plan ✅ (2026-11-21)

Final runs on the dev machine (Windows, i5 8th gen, 16 GB): `npm run check` 266 unit + worker tests passed;
`npm run test:e2e` 181 passed, 3 skipped, 0 failed, 0 flaky (Chromium, Firefox, Pixel 7: 113 passed, 1 skipped
in 5.5 min; WebKit, iPhone 14: 68 passed, 2 skipped in 7.7 min).

- [x] Unit: crypto, protocol (incl. `INFO.now`), base64url edge cases, limits vs. the specification, edit limit,
      serial queue (order, keeps going after a failure, logs only "internal error"), `compactState`, configs
- [x] Worker: lifecycle, alarm, End now, compaction (incl. re-request right after an answer), limits, close
      codes, Origin, headers, every client-sent server-only frame type, empty frame, awareness > 1 MB, SNAPSHOT > 5 MB + 5, 20 clients dropping and reconnecting at once (peer counts), `INFO.now`
- [x] E2E, all five projects (`tests/e2e/`): create, two-client sync, reload, empty pad, Unicode incl. CRLF
      (test 14), undo/redo own edits only, language sync + reload, theme persists, countdown after reload and
      with the device clock 2 h fast, QR dialog, name input (id/name, shared, never parsed as HTML), End now,
      privacy, incomplete link (missing, empty, truncated, too long, invalid characters, percent junk,
      non-canonical key), wrong key (others untouched), unknown pad, malformed paths → 404, 15 s expiry on all
      clients then not found (test 16), same-position typing (test 10), rapid typing, 500 KB paste syncs and
      6 MB blocked with others unaffected (test 13), offline/reconnect incl. both clients offline (test 15),
      360 px: no horizontal scroll, drawer (Esc, outside tap, close button), touch targets ≥ 44 px, editor font
      ≥ 16 px (test 20), security headers on the running server (test 21), clipboard (test 18)
- [x] E2E, Chromium only (`@heavy`): edit-size boundary search, 5,000/20,000-line files with 500-line add/delete,
      4 MB pad, 8 × 900 KB paste/delete under 5 MB, late joiner after compaction (test 12), five clients
      random-editing 30 s (test 11), 51st person → pad full, ten clients dropped at once
- [x] Every E2E test fails on any console error or page error, and checks that pad IDs and keys never appear in
      console output
- [x] No logging: still only the two generic `console.error("internal error")` calls; no error path includes
      text, keys, tokens or IDs
- [x] Cleanups: name input has `id`/`name` `display-name`; countdown uses the server clock (`INFO.now`)

Bugs found and fixed:

1. **Pad fills up although its text is small (5 MB limit).** The live Y.Doc keeps deleted text for the undo
   manager, and snapshots were `Y.encodeStateAsUpdate(doc)`, so they carried every paste ever deleted (seen:
   1.8 MB, then 3.7 MB, with < 1 MB visible). Repeated large paste/delete ended in "This pad is full". Fix:
   snapshots come from a fresh copy where Yjs garbage-collects deleted content (`compactState`); now ~0.9 MB.
2. **Compaction request throttled after it was answered.** The 10 s wait applied to every request, so fast
   successive large edits outran compaction. Fix: the wait only covers unanswered requests (`pad.ts`).
3. **CRLF lost (test 14).** CodeMirror turned pasted `\r\n` into `\n`. Fix: `lineSeparator: "\n"` so `\r` stays
   in the text, and `\r` is removed from the special-character set so it draws as whitespace, not a red dot.
4. **Countdown wrong with a wrong device clock.** Fix: `INFO.now` (server clock) and a clock offset.
5. **Test infrastructure (not app bugs, fixed at the cause):** extra browser contexts were never closed and
   slowed later tests (worst in WebKit); `modKey` used the user agent, but CodeMirror decides Mac-ness from
   `navigator.platform`; Playwright's `Shift+z` sends a lower-case key; Android emulation drops an Enter typed
   straight into following text; Windows' clipboard converts `\n` to `\r\n` on read-back; the expiry test did
   unrelated work against its 15 s deadline; two WebKit instances at once on this machine made each keystroke
   ~300 ms instead of ~15 ms, so the WebKit projects run with one worker (`test:e2e:webkit`); the serial-queue
   unit test waited a fixed 60 ms instead of for the queue (failed once under load).

Measured (Chromium, this laptop, local `wrangler dev`; machine-dependent, not asserted):

| Case                                   | Result                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Largest ASCII paste that syncs         | 1,044,339 bytes (one more byte is blocked with the "too large" message)                                       |
| 5,000 lines (216 KB)                   | paste → other client 487 ms; 500-line add + delete → back 290 ms; keystroke 16.8 ms; typed line remote 364 ms |
| 20,000 lines (882 KB)                  | paste → other client 911 ms; 500-line add + delete → back 478 ms; keystroke 19.1 ms; typed line remote 610 ms |
| 4 MB pad (four 1 MB pastes)            | keystroke 21.6 ms; typed text remote 750 ms; late joiner loaded 1,545 ms                                      |
| 8 × 900 KB paste + delete (7 MB total) | never over 5 MB; 4 snapshots; pad stays usable                                                                |

Degradation is mild up to 4 MB: local typing goes from ~17 to ~22 ms per keystroke. A single paste over ~1 MB is
blocked by design; the 20,000-line file fits.

Could not test here, or verified only partly (stated honestly):

- **Clipboard read-back in Firefox, WebKit, iPhone 14:** skipped. Playwright cannot grant clipboard permissions
  there (Firefox: no clipboard permissions; WebKit: "Unknown permission: clipboard-write"). Verified in Chromium
  and Pixel 7 only.
- **Paste in Firefox:** synthetic paste events carry no data in Firefox, so the E2E paste there is a CodeMirror
  transaction tagged `input.paste`. It goes through the same change filter (the size limit) but not Firefox's
  own paste event handling.
- **Network drops:** `context.setOffline(true)` does not close an open WebSocket in any engine here (verified;
  `navigator.onLine` turns false, the socket stays up; the app now reacts to the `offline` event itself). Drops are simulated with Playwright's `routeWebSocket`,
  closing both sides of the real connection. Not tested: a real radio/Wi-Fi loss on a device.
- **Mobile:** Pixel 7 and iPhone 14 are emulations (desktop Chromium/WebKit with a phone viewport, user agent and
  touch); no real Android keyboard (IME) or iOS Safari was used.
- **Large documents** were measured in Chromium only; WebKit on Windows is much slower in Playwright and not
  representative of Safari.
- The edit-size limit is an estimate checked in the editor; the boundary test shows the largest allowed ASCII
  paste is also accepted by the server. Multi-byte text was unit-tested, not boundary-searched in E2E.
- The E2E text reader uses CodeMirror's internal `cmTile.view` (test-only); a CodeMirror update may rename it
  (the helper then fails with a clear message).
- Hibernation: per-socket state is in attachments and verified by design and review; the local runtime gives no
  way to force hibernation in a test.

Decisions / notes:

- `INFO` gained `now` (server ms). An old client still open during a deploy ignores the extra field; a new client
  requires it, which is fine because the Worker and the client assets deploy together.
- `\r` in the text is drawn as whitespace and is one extra cursor stop at the end of a CRLF line; this keeps
  test 14's "exact round-trip" and keeps every client's CodeMirror text equal to the shared Y.Text.
- (Superseded by the follow-up below: the app now has a heartbeat and listens to `offline`/`online`.)

### Phase 7 follow-up (2026-11-21): compaction IDs, heartbeat, offline events

Final runs: `npm run check` 279 unit + worker tests passed (21 files); `npm run test:e2e` 196 passed, 3 skipped
(clipboard in Firefox, WebKit, iPhone 14), 0 failed, 0 flaky: Chromium, Firefox, Pixel 7 122 passed, 1 skipped
in 5.1 min; WebKit, iPhone 14 74 passed, 2 skipped in 7.2 min.

**1. Compaction keeps Yjs item IDs (verified).** `compactState` encodes the live doc with
`Y.encodeStateAsUpdate` and applies that update to a fresh `Y.Doc` (gc on, the default). Applying an update
integrates the original structs with their original IDs (client ID + clock); nothing is re-inserted. Deleted
items in the copy are garbage-collected: their content is dropped and they become `GC` structs covering the same
ID ranges. `Y.encodeStateAsUpdate(copy)` then writes those IDs. Tests:

- `tests/unit/snapshot.test.ts`: for every index of a churned document, the relative position (which names the
  item ID) in the compacted copy equals the original's, and the state vectors are identical; a full-history
  client and a snapshot joiner edit concurrently at the edge of a garbage-collected run, both ends and mid-word,
  and three docs converge.
- `tests/e2e/compaction.spec.ts` (all five projects): A stays connected and keeps typing; two 600 KB pastes
  next to old text are deleted again; compaction happens (COMPACT_REQUEST received, SNAPSHOT sent); the late
  joiner's `SYNC_ALL` is < 64 KB (proves the server replaced the rows and the deleted pastes are gone); A and B
  then insert at the same spots at once (where the pastes were, both ends, inside a word); both texts are
  identical, every insert is present, the old text is intact, and a third client loads the same text.
  Passed in Chromium and WebKit (2 repeats each) and in the full run.

**2. WebKit + iPhone 14 re-run in full** after all edits: see the final runs above.

**3. Half-open connections: heartbeat (built, because it is free).** Cloudflare docs checked 2026-11-21:

- `state.setWebSocketAutoResponse` (Durable Object State API): matching requests get the response "without
  waking WebSockets in hibernation and incurring billable duration charges"; request and response ≤ 2,048
  characters each; `getWebSocketAutoResponseTimestamp` records the last one.
- Durable Objects pricing: auto-responses "will not incur additional wall-clock time, and so they will not be
  charged". Free plan: 100,000 requests/day, 13,000 GB-s/day; incoming WebSocket messages bill at 20:1.
- Assumption (not stated explicitly by the docs): "not charged" also means not counted against the Free plan's
  daily request limit, since that limit is defined in the same billing units.
- For comparison, without auto-response: one tab pinging every 25 s = 3,456 messages/day = ~173 billed
  requests/day and a wake-up each time. With it: 0.

Implementation: `src/client/heartbeat.ts` (ping every 25 s while visible, dead after 10 s without pong, paused
when hidden, immediate ping on becoming visible); `provider.ts` gives up on a dead connection at once (banner,
close `1000`, normal backoff), listens to `offline` (give up at once, no retries while
`navigator.onLine` is false) and `online` (reconnect at once, backoff reset); `pad.ts` registers the auto-response
in the constructor. Pings are the fixed text `ping`, pongs `pong`; no content, no logging. Documented in
`docs/protocol.md` (Heartbeat).

Tests: `tests/unit/heartbeat.test.ts` (6, fake timers), `tests/worker/heartbeat.test.ts` (pong; 120 pings in a
burst are all answered, never reach `webSocketMessage`, leave the rate window at 0 hits, socket stays open; any
other text still closes `1003`), protocol drift guards, and two E2E tests in `offline.spec.ts` (all five
projects): a stalled connection (Playwright route that keeps the socket open but forwards nothing either way)
is detected within 35 s, the client closes it with `1000`, reconnects and merges both sides' edits;
`setOffline(true)` shows the banner within 3 s, no retries while offline, `setOffline(false)` reconnects within
3 s and merges.

Found while testing: after a heartbeat failure the banner is up only until the reconnect starts (< 1 s with a
working network). The first E2E version waited for it with Playwright polling and missed it; the test now
records the banner in the page (MutationObserver). Behaviour is the same as after any other drop.

Still not testable here: a real mobile network going half-open; actual Cloudflare billing of auto-responses
(checked in the docs only, verify in the dashboard after deploy); hidden-tab pausing is unit-tested, not E2E
(Playwright pages are always visible).

### Pre-deploy fixes from an external code review (2026-11-21)

Final runs: `npm run check` 292 unit + worker tests passed (23 files); `npm run test:e2e` 231 passed, 3 skipped
(clipboard in Firefox, WebKit, iPhone 14), 0 failed: Chromium, Firefox, Pixel 7 143 passed, 1 skipped in 4.7 min;
WebKit, iPhone 14 88 passed, 2 skipped in 6.7 min. (An earlier run of this suite lost three Pixel 7 tests to
`net::ERR_NETWORK_IO_SUSPENDED`, the OS suspending network I/O on the laptop, and stopped before WebKit; the same
tests passed in the other browsers in that run, and a complete re-run is green.)

1. **Typecheck failed on a fresh clone (real, confirmed).** `wrangler types` turns the `ALLOW_TEST_TTL` value from
   `wrangler.jsonc` ("0") into the literal type `"0"` when there is no `.dev.vars`, so the comparisons with `"1"`
   in `create-pad.ts` and `origin.ts` do not typecheck. Reproduced with `.dev.vars` renamed (exact errors from the
   review). Fix: `"types": "wrangler types --strict-vars=false"` (type `string`). Verified: `npm run check` passes
   with `.dev.vars` renamed; `.dev.vars` restored afterwards. `wrangler.jsonc` still has "0".
2. **Oversized reconnect diff (real, reproduced first).** After a drop the client sent everything the server lacked
   as one `UPDATE`. With a 900 KB paste lost in flight (connection half-open, then closed) and an 800 KB paste made
   offline, the diff was ~1.7 MB: the server answered `4013`, the client showed "This pad is full", its editor was
   torn down and B never received the text. The offline budget did not count the lost update because its batch had
   already been flushed. Fix: `src/client/local-log.ts` keeps the updates this client made (each fits a frame);
   when the diff does not fit, the logged updates the server lacks are resent, packed into frames that each fit.
   A Yjs update cannot be cut into a prefix with the public API, which is why the pieces are kept instead.
   Tests: `tests/unit/local-log.test.ts` (7), E2E `offline.spec.ts` "edits lost in flight" (failed before the fix,
   passes after; stall + drop simulate the lost update). Limit: if more than 16 MB of local updates have piled up
   since the server last held everything, old entries are dropped and the old behaviour (one diff, possible
   `4013`) applies. The 16 MB log lives in memory until the next sync.
3. **Key-check race (real, narrow).** Reproduced at flow level: a client with a different key that joins an empty
   pad before the creator has synced writes the key-check row, and the creator sees "Wrong key"
   (`key-check.spec.ts`, pins the behaviour). The legitimate flow only exposed it through the share buttons, which
   existed before the socket connected. Fix: **Copy link** and **QR code** stay disabled (with a title) until this
   client has synced for the first time, then stay enabled. **Copy all** is not held back (no link). Residual risk:
   someone who learns the pad ID by other means (the server sees it) can still lock the creator out in the
   first moments; no secret is exposed. Not changed: the key check is sent just before the status turns
   "Connected", without a server acknowledgement, so a lost first frame is theoretically possible.
4. **Admin tokens never removed (real).** `admin:<padId>` now stores `{token, expiresAt}`; every page load removes
   entries expired for more than an hour (grace so a fast device clock cannot drop a live pad's token) and entries
   in any other format (old plain-text entries from earlier builds count: they carry no expiry); the entry is also
   removed when the pad is ended, found expired or not found (this was already so). Tests:
   `tests/unit/admin-token.test.ts` (6), `admin-token.spec.ts`, and storage checks in the End-now test.
5. **`public/_headers` comment** pointed to a test that does not exist; it names `tests/unit/config.test.ts`.

Verified vs assumed: items 1–4 were reproduced or measured by tests that failed before the fix (1: the type errors;
2: E2E "edits lost in flight"; 3: the race test, and the disabled-button test failed with enabled buttons). The 16 MB
log cap and the one-hour grace are my choices, not measured needs.

## Phase 8 — README, docs, deploy
