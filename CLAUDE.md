# CLAUDE.md — PoofPad

End-to-end encrypted, real-time shared text pad with a creator-chosen expiry (like codeshare.io / rustpad.io).
This file is the single source of truth. Read it fully before writing code.

## 0. Rules for you (Claude Code)

1. Build **only** what this file specifies. No extra features, pages, frameworks or dependencies. If something seems missing, ask.
2. Before using any library or platform API, check its **current official docs** (Cloudflare Workers, Durable Objects,
   Wrangler, Workers Static Assets, Yjs, y-protocols, y-codemirror.next, CodeMirror 6, Vitest, Playwright). Do not code from memory.
3. No placeholder code, no TODO stubs, no commented-out code, no unused exports or dependencies.
4. TypeScript `strict`. No `any`. Small, single-purpose files. Prefer plain functions over classes, except the Durable Object class.
5. Work in the phases in section 9. At the end of each phase: `npm run check` passes, update `docs/progress.md`,
   show me a summary, and **stop and wait** for me to say "continue".
6. Never log pad content, pad IDs, keys, tokens or IPs (section 5).
7. Dev machine is **Windows 11/10, PowerShell, VS Code**. All npm scripts must be cross-platform (no bash-only syntax,
   no `rm -rf`, no `&&` chains that break in PowerShell inside package.json — use npm-run-all or node scripts if needed).
8. Ask before any destructive action (deleting files outside this repo, `wrangler delete`, force-pushing git).

## 1. Product

- Landing page: **New pad** button + expiry picker (10 min, 1 h, 6 h, 24 h — default 1 h; 24 h is the max) + a "Join with link" box.
- Pad page (Rustpad-style): a left sidebar (~260 px) and an editor filling the rest of the width and the full height;
  everyone with the link can edit live from phone, tablet or laptop. Normal cut/copy/paste everywhere.
  Sidebar, top to bottom: (1) PoofPad title + theme toggle; (2) connection status, countdown to expiry, **End now**
  (creator only, with confirmation); (3) language picker; (4) Share: **Copy link**, **Copy all**, **QR code**
  (the QR dialog shows the link text under the code); (5) Active users: heading with the count, one row per person
  (colour dot + name), own row first, marked "(you)" and editable, others read-only; (6) Privacy link.
- Live cursors/selections of others: random colour + random anonymous name (editable, stored in localStorage). A remote
  cursor shows its owner's name label while they type or move, and on hover.
- Names are limited to 24 characters with control characters stripped; remote colours must match `#rrggbb` or fall
  back to a default. Names are rendered with `textContent` only.
- Expiry: at zero, server deletes everything; every client shows "This pad has expired".
- Dark theme default (VS Code Dark+ look like rustpad.io): bg `#1e1e1e`, panels `#252526`, text `#d4d4d4`, accent `#0e639c`.
  Light theme toggle, remembered in localStorage; first visit follows `prefers-color-scheme`.
- Languages: Plain text (default), JavaScript, TypeScript, Python, Java, SQL, JSON, HTML, CSS, Markdown, XML, YAML.
  Language choice is shared via the Y.Doc (a `Y.Map` named `meta`), so everyone sees the same mode.
- Mobile (< 768 px, ≥ 360 px wide): the sidebar becomes a slide-in drawer opened by a hamburger button and closed with Esc,
  a tap outside or its close button; a slim top bar shows the countdown and people count. Touch targets ≥ 44 px, editor
  font ≥ 16 px (prevents iOS zoom), no horizontal page scroll.
- Screens for: expired, not found, pad full, link missing key ("This link is incomplete"), wrong key, service busy (free quota hit), offline/reconnecting.
- Static `/privacy` page (short, plain English).

Out of scope: accounts, history, file upload, chat, read-only links, passwords, analytics.

## 2. Architecture

```
Browser (Vite + TS, CodeMirror 6, Yjs)  --wss, encrypted binary frames-->  Cloudflare Worker  -->  Durable Object "Pad" (1 per pad)
                                                                                                   - SQLite: encrypted updates + meta
                                                                                                   - alarm: deletes everything at expiry
```

- **Cloudflare Workers Free plan.** Worker serves static assets (Workers Static Assets) and routes `/api/*` and `/ws/*`.
- **Durable Object `Pad`**, SQLite backend (required on the Free plan), addressed by `idFromName(padId)`.
  Uses the **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`, `webSocketError`,
  `serializeAttachment`/`deserializeAttachment`). No in-memory state may be required for correctness (hibernation wipes it).
- **No server frameworks** (no Hono, no PartyServer). Worker routing is a small hand-written `switch`.
- **Client:** vanilla TypeScript (no React). CodeMirror 6 + `y-codemirror.next` + Yjs + `y-protocols/awareness`.
  Custom provider in `provider.ts` (do not use y-websocket — it cannot encrypt).

### 2.1 End-to-end encryption

- Pad URL: `https://<host>/p/<padId>#<key>`. The fragment is never sent to servers.
- `padId`: 16 random bytes, base64url (22 chars). Validate with `/^[A-Za-z0-9_-]{22}$/`.
- `key`: 32 random bytes, base64url, imported as a WebCrypto AES-GCM 256 key (non-extractable after import).
- Every frame payload (doc updates, snapshots, awareness) = `iv(12 bytes) || AES-GCM ciphertext`. New random IV per message.
- Decrypt failure → treat as wrong key; show the wrong-key screen; never apply partial data.
- Server never sees plaintext and cannot read pads.

### 2.2 Wire protocol (binary WebSocket frames)

First byte = type, rest = payload. Defined once in `src/shared/protocol.ts`, documented in `docs/protocol.md`.

| Type | Dir | Payload | Stored? |
|---|---|---|---|
| `UPDATE` 1 | C→S→others | encrypted Yjs update | yes, 1 row |
| `AWARENESS` 2 | C→S→others | encrypted awareness update | no |
| `SYNC_ALL` 3 | S→C on join | all stored rows, length-prefixed | — |
| `COMPACT_REQUEST` 4 | S→one C | uint32 `upToSeq` | — |
| `SNAPSHOT` 5 | C→S | uint32 `upToSeq` + encrypted `Y.encodeStateAsUpdate` | replaces rows ≤ upToSeq |
| `INFO` 6 | S→C | JSON `{ peers, expiresAt }` on join and on peer change | — |
| `ERROR` 7 | S→C | uint8 code (see 3.3) then close | — |

- Client batches local Yjs updates for **250 ms** (`Y.mergeUpdates`) before encrypting and sending one `UPDATE`.
- Client throttles awareness to one frame per **250 ms**. Awareness is relayed, never stored.
- **Compaction:** when stored rows > 300 or stored bytes > 1 MB, server sends `COMPACT_REQUEST` (current max seq) to one
  client. On `SNAPSHOT`, in one transaction: delete rows `seq ≤ upToSeq`, insert snapshot as a new row with `seq = upToSeq`.
  Rows with `seq > upToSeq` that arrived meanwhile must survive. Ignore stale/duplicate snapshots.

### 2.3 Storage (DO SQLite)

```
meta(id INTEGER PRIMARY KEY CHECK (id = 1), expires_at INTEGER NOT NULL, admin_hash TEXT NOT NULL)
updates(seq INTEGER PRIMARY KEY, data BLOB NOT NULL)
```

### 2.4 HTTP / WS routes

- `POST /api/pads` body `{ ttl: 600 | 3600 | 21600 | 86400 }` → creates pad, sets alarm, returns `{ padId, adminToken, expiresAt }`.
  `adminToken` = 32 random bytes base64url; store only SHA-256 hex. Creator keeps it in localStorage under `admin:<padId>`.
- `GET /ws/<padId>` → WebSocket upgrade into the Pad DO.
- `POST /api/pads/<padId>/end` with `Authorization: Bearer <adminToken>` → constant-time hash compare → burn pad.
- `/p/<padId>` and `/privacy` → serve the SPA (`index.html`).
- Anything else → 404.

### 2.5 Expiry

- `alarm()` and "End now" both: close all sockets with code 4001, then `ctx.storage.deleteAll()` (also deletes the alarm).
- Check `expires_at` on every request and message too (alarms can fire late). Unknown or expired pad → 404 / close 4004.
- Dev/test only: allow `ttl: 15` when env var `ALLOW_TEST_TTL === "1"` (set in `.dev.vars`, which is gitignored; never in production).

## 3. Limits and scaling

### 3.1 Constants (all in `src/shared/limits.ts`)

| Constant | Value |
|---|---|
| Max peers per pad | 50 |
| Max frame size | 1 MB (a 500 KB paste fits in one frame; DO SQLite allows 8 MB per row/BLOB). `SNAPSHOT` frames may be up to 5 MB + 5 bytes, since a snapshot replaces stored rows |
| Max change per edit | Local edits (incl. paste, undo, redo) whose Yjs update would not fit one frame are blocked in the editor before they reach the Y.Doc, with a clear message |
| Max stored bytes per pad | 5 MB |
| Max messages per socket | 40 / second (sliding 1 s window) |
| Allowed TTLs | 600, 3600, 21600, 86400 (+15 in test mode) |
| Update batch window / awareness throttle | 250 ms / 250 ms |
| Reconnect backoff | 0.5 s doubling to 10 s, with jitter |
| Compaction trigger | > 300 rows, or > 1 MB in the rows after the oldest (base snapshot) row; re-requested after 10 s if unanswered |

### 3.2 Why these numbers (Cloudflare Workers Free plan, verified Nov 2026 — re-check the docs page)

Free plan Durable Object limits per day: 100,000 requests (20 incoming WS messages count as 1), 13,000 GB-s duration,
5 M SQLite rows read, **100,000 SQLite rows written**; 5 GB storage total. Exceeding one makes that operation fail until 00:00 UTC.
Rows written is the tightest limit, which is why updates are batched (250 ms) and compacted.
When a storage write fails because of quota, send `ERROR` code 5 ("service busy") and close; the client shows the service-busy screen.

### 3.3 Close / error codes

4001 expired · 4004 not found · 4008 rate limited · 4009 pad full · 4013 too large · 4003 bad origin · 4005 service busy.

## 4. Security

- Response headers on all HTML and assets (verify in Workers Static Assets docs whether to use a `_headers` file or
  `run_worker_first`; choose the documented approach):
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`
    (`connect-src 'self'` covers same-origin wss in current browsers — verify; add explicit `wss://<host>` only if needed.)
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff` · `Referrer-Policy: no-referrer` · `Cross-Origin-Opener-Policy: same-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-write=(self)`
- WebSocket upgrade: reject if `Origin` host ≠ request host (allow `localhost:*` only when `ALLOW_TEST_TTL === "1"`).
- Validate everything: padId regex, TTL whitelist, JSON body shape and size (≤ 1 KB), frame type, frame size, seq values.
- No cookies, no third-party scripts, fonts or CDNs. Everything bundled.
- Escape/never `innerHTML` user-controlled strings (names, pad text). Use `textContent`.
- README documents one Cloudflare dashboard rate-limiting rule for `POST /api/pads` (verify the free-plan option in docs).

## 5. No logging

- No `console.*` in production code paths except a generic `console.error("internal error")` without identifiers.
- `wrangler.jsonc`: `"observability": { "enabled": false }`. No Logpush, no Analytics Engine, no Workers Analytics bindings.
- Ciphertext is kept only until expiry, then `deleteAll()`.

## 6. Repo structure (public GitHub repo — keep it clean)

```
.
├── CLAUDE.md
├── README.md              what it is, screenshot, features, how it works (diagram), security model,
│                          local dev on Windows/macOS/Linux, deploy to own Cloudflare account, custom domain, limits, license
├── LICENSE                MIT
├── .gitignore             node_modules, dist, .wrangler, .dev.vars, test-results, playwright-report, coverage
├── .gitattributes         * text=auto eol=lf
├── .editorconfig
├── package.json
├── tsconfig.json
├── wrangler.jsonc         no account_id committed
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── docs/
│   ├── protocol.md
│   └── progress.md        phase checklist, updated at the end of every phase
├── public/                favicon, icons
├── src/
│   ├── shared/            protocol.ts, limits.ts, codes.ts
│   ├── worker/            index.ts (routing), pad.ts (Durable Object), http.ts (headers/responses)
│   └── client/            main.ts, router.ts, crypto.ts, provider.ts, editor.ts, theme.ts, ui/*.ts, styles.css, index.html
└── tests/
    ├── unit/              crypto, protocol
    ├── worker/            Durable Object behaviour (@cloudflare/vitest-pool-workers)
    └── e2e/               Playwright
```

npm scripts: `dev`, `build`, `typecheck`, `lint` (eslint flat config, minimal), `format` (prettier), `test` (unit + worker),
`test:e2e`, `check` (typecheck + lint + test), `deploy`.

## 7. Dependencies (only these unless I approve more)

Runtime client: `yjs`, `y-protocols`, `y-codemirror.next`, `codemirror`, `@codemirror/state`, `@codemirror/view`,
`@codemirror/language`, needed `@codemirror/lang-*` packages, `@codemirror/legacy-modes` (for SQL/YAML only if no lang package),
one tiny QR library with zero dependencies.
Dev: `typescript`, `vite`, `wrangler`, `@cloudflare/vitest-pool-workers`, `vitest`, `@playwright/test`, `eslint`,
`typescript-eslint`, `prettier`. Worker types via `wrangler types`. Pin exact versions.

## 8. Test plan (all must pass before deploy)

Unit / worker:
1. Crypto round-trip; tampered ciphertext rejected; wrong key rejected; IVs never repeat across 10,000 encryptions.
2. Protocol encode/decode for every type; unknown type, empty frame and oversize frame rejected.
3. Create pad with each valid TTL; invalid TTL (0, -1, 99999, "3600", missing, extra fields) → 400.
4. Invalid padIds (short, long, bad chars, `../`, URL-encoded junk) → 404 without creating a DO entry.
5. Alarm closes sockets with 4001 and leaves storage empty; later requests → 404.
6. End now: wrong/missing token → 401; correct token burns pad.
7. Compaction keeps rows that arrive between request and snapshot; stale snapshot ignored.
8. Stored bytes contain no plaintext (insert a known marker string, scan storage).
9. 51st socket → 4009; flood → 4008; bad Origin → 4003; > 5 MB stored → 4013.

E2E (Playwright: Chromium, WebKit, Firefox; device profiles "Pixel 7" and "iPhone 14"):
10. Two clients type at the same position simultaneously → identical final text, no lost characters.
11. Five clients random-edit for 30 s → all converge.
12. Late joiner gets full text after compaction has happened.
13. 500 KB paste works; 6 MB paste shows a clear error and other clients are unaffected.
14. Unicode round-trip exact: emoji, Hindi (Devanagari), Arabic (RTL), CRLF, tabs, zero-width joiner.
15. One client offline, both edit, reconnect → merged correctly.
16. 15 s test pad expires on all clients and shows the expired screen; reload after expiry shows not-found.
17. Link without `#key` → incomplete-link screen. Wrong key → wrong-key screen, doc untouched for others.
18. Copy all / Copy link produce the right clipboard text (grant clipboard permission in test).
19. Theme persists across reload; countdown correct after reload; language change syncs to other clients.
20. 360 px viewport: no horizontal scroll, menu works, no console errors on any page.
21. Security headers present on `/`, `/p/<id>`, `/privacy`, a JS asset.

Fix root causes. Never skip, weaken or delete a test to make it pass.

## 9. Phases (stop after each)

1. **Scaffold** — repo files from section 6, configs, empty-but-running worker + DO + Vite page. `npm run dev` works on Windows.
2. **Realtime sync, unencrypted** — protocol, provider, DO relay + storage, SYNC_ALL, batching, hibernation-safe. Two tabs sync.
3. **Encryption** — crypto.ts, key in fragment, all payloads encrypted, tests 1, 8.
4. **Expiry, End now, limits, compaction** — tests 3–7, 9.
5. **UI** — themes, language picker, cursors, copy/QR, countdown, mobile menu, all error screens, privacy page.
6. **Hardening** — headers, Origin check, validation, no-logging audit (grep for `console.`), dependency audit (`npm audit`).
7. **Full test plan** — unit, worker, E2E. Fix everything. Production build + `wrangler dev` smoke test.
8. **README + docs** final pass, then deploy with `npm run deploy` and run E2E against the live URL (`BASE_URL` env var).
   Production domain is **poofpad.com** (registered on Cloudflare, same account). After the first successful deploy to
   `*.workers.dev`, attach it as a Workers **Custom Domain** in `wrangler.jsonc` (verify current config syntax in docs),
   redeploy, and re-run E2E against `https://poofpad.com`. Keep `workers.dev` disabled in production once the custom domain works.
