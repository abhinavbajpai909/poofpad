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

## Phase 2 — Realtime sync, unencrypted

## Phase 3 — Encryption

## Phase 4 — Expiry, End now, limits, compaction

## Phase 5 — UI

## Phase 6 — Hardening

## Phase 7 — Full test plan

## Phase 8 — README, docs, deploy
