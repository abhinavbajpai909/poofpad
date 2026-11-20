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

## Phase 3 — Encryption

## Phase 4 — Expiry, End now, limits, compaction

## Phase 5 — UI

## Phase 6 — Hardening

## Phase 7 — Full test plan

## Phase 8 — README, docs, deploy
