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
- `_headers` only covers static-asset responses; Worker responses get the same headers from `http.ts` (Phase 6).

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

- [x] Max frame raised to 1 MB (decision 1); CLAUDE.md §3.1 and `docs/protocol.md` updated. Checked against
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

## Phase 5 — UI

## Phase 6 — Hardening

## Phase 7 — Full test plan

## Phase 8 — README, docs, deploy
