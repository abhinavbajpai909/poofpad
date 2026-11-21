# PoofPad wire protocol

Binary WebSocket frames on `GET /ws/<padId>`. The first byte is the frame type; the rest is the payload.
All encrypted payloads are `iv (12 bytes) || AES-GCM ciphertext`, with a fresh random IV per message.

| Type              | Value | Direction   | Payload                                                      | Stored?                   |
| ----------------- | ----- | ----------- | ------------------------------------------------------------ | ------------------------- |
| `UPDATE`          | 1     | C→S→others  | encrypted Yjs update                                         | yes, 1 row                |
| `AWARENESS`       | 2     | C→S→others  | encrypted awareness update                                   | no                        |
| `SYNC_ALL`        | 3     | S→C on join | all stored rows, length-prefixed                             | —                         |
| `COMPACT_REQUEST` | 4     | S→one C     | uint32 `upToSeq`                                             | —                         |
| `SNAPSHOT`        | 5     | C→S         | uint32 `upToSeq` + encrypted document state (`compactState`) | replaces rows ≤ `upToSeq` |
| `INFO`            | 6     | S→C         | JSON `{ peers, expiresAt, now }` on join and on peer change  | —                         |
| `ERROR`           | 7     | S→C         | uint8 `closeCode − 4000`, then close with `closeCode`        | —                         |

## Close codes

| Code | Meaning      |
| ---- | ------------ |
| 4001 | expired      |
| 4003 | bad origin   |
| 4004 | not found    |
| 4005 | service busy |
| 4008 | rate limited |
| 4009 | pad full     |
| 4013 | too large    |

`1003` (unsupported data) is also used when a client sends a text frame other than the heartbeat ping, an
unknown frame type, or a server-to-client frame type.

## Encodings

- Integers are big-endian.
- `SYNC_ALL` payload: zero or more rows, each `uint32 length || row bytes`, in `seq` order. A new pad sends an
  empty payload. Server→client frames have no size cap.
- Client→server frames are capped at **1 MB** (`MAX_FRAME_BYTES`, including the type byte). `SNAPSHOT` is the
  exception: up to 5 MB + 5 bytes (`MAX_SNAPSHOT_FRAME_BYTES`), because it replaces stored rows and can be as large
  as the whole pad. Both are far below the Durable Object limits (8 MB per SQLite row/BLOB, 32 MiB per WebSocket
  message). An oversize frame closes the socket with `4013`.
- `COMPACT_REQUEST` payload: `uint32 upToSeq` (≥ 1).
- `SNAPSHOT` payload: `uint32 upToSeq || encrypted compactState(doc)` (a Yjs update; data must be non-empty).
- `ERROR` payload: one byte, `closeCode − 4000` (e.g. `5` = service busy, `13` = too large). The server then
  closes with that close code. Clients prefer the `ERROR` code over the close code, in case a proxy rewrites it.
- `INFO` payload: UTF-8 JSON `{ "peers": <int>, "expiresAt": <unix ms>, "now": <unix ms> }`. `peers` counts
  open sockets including the receiver. `now` is the server clock when the frame was sent; the client keeps
  `now − Date.now()` as a clock offset so the countdown is right even when the device clock is wrong.

## Encryption

- Pad URL: `/p/<padId>#<key>`. `key` is 32 random bytes as unpadded, canonical base64url (43 chars). Browsers
  never send the fragment to a server, and the WebSocket URL is built from the host and `padId` only.
- The key is imported with WebCrypto as a non-extractable AES-GCM 256 key. A missing or malformed key shows
  the "This link is incomplete" screen and opens no socket.
- Every `UPDATE`, `AWARENESS` and `SNAPSHOT` payload (for `SNAPSHOT`, the part after `upToSeq`), and so every
  stored row, is
  `iv (12 random bytes) || AES-GCM ciphertext || 16-byte tag`, with a new IV per message.
- AES-GCM additional data is one byte naming what the payload is: `1` for document data (updates and
  snapshots), `2` for awareness. A payload decrypted under the wrong one fails, like a wrong key.
- **Key check.** A client that receives an empty `SYNC_ALL` sends one `UPDATE`, even when it has no edits
  (an empty Yjs update). So the first stored row of every pad that has been opened proves which key is right.
- **Decrypt failures.** If the first `SYNC_ALL` row fails to decrypt, the key is wrong: the client applies
  nothing, closes the socket with `1000`, does not reconnect, and shows the wrong-key screen. Any other row
  or relayed frame that fails to decrypt came from someone else with a different key. It is dropped and
  nothing from it is applied.
- Incoming frames are decrypted and applied one at a time, in arrival order.

## Connection lifecycle

1. Client opens `GET /ws/<padId>`. Unknown or expired pad → socket accepted, sent `ERROR`, then closed with `4004`.
2. Server sends `SYNC_ALL`, then broadcasts `INFO` to everyone (including the new client).
3. Client applies all rows. If its local document has anything the server does not (offline edits, compared by
   Yjs snapshot: state vector + delete set), it sends the missing part as one `UPDATE`. That diff can be larger
   than one frame even though every edit fitted: an update sent just before the connection died can be lost in
   flight, and then it and the offline edits are both missing. A Yjs update cannot be cut into smaller ones, so the
   client keeps a log of the updates it made itself (`local-log.ts`: small neighbours merged, at most 16 MB) and,
   when the diff does not fit, sends the logged updates the server lacks (checked against the `SYNC_ALL` state),
   packed into frames that each fit. Log entries the server is known to hold are dropped at every sync. If old
   entries had to be dropped (more than 16 MB of local updates since the server last had everything), the diff is
   sent as before and the server may answer `4013`.
4. Local edits are merged for 250 ms (`Y.mergeUpdates`) and sent as one `UPDATE`; the server stores it as one row
   and relays it unchanged to the other sockets.
5. Awareness is throttled to one frame per 250 ms and relayed, never stored. When `INFO.peers` increases, every
   client re-announces its awareness state so the newcomer sees existing cursors. On `pagehide` a client sends
   its awareness as `null`.
6. On close the server broadcasts a new `INFO`. Clients reconnect with backoff (0.5 s doubling to 10 s, jittered)
   unless the close code is terminal (any `4xxx` except `4008`, or `1003`).
7. A connection can die without closing (common on mobile networks); see Heartbeat. A client that gives up on
   a connection closes it with `1000` and reconnects as in step 6. Edits made meanwhile were kept locally and
   go out as one diff after the next `SYNC_ALL` (step 3).

## Key check and sharing

The first stored row of a pad is its key check (see Encryption), written by the first client to sync. Whoever
writes it first decides which key counts as right: a client with a different key that reaches an empty pad
before the creator's client has synced would make the creator see "Wrong key". Pad IDs are random and only the
creator's browser (and the server) knows one until the link is shared, so the client closes the remaining window:
the **Copy link** and **QR code** buttons stay disabled until this client has synced for the first time (its key
check, if it was needed, is sent just before the status turns "Connected"), and stay enabled after that.

## Admin token storage

The creator's admin token is stored in `localStorage` as `admin:<padId>` = `{"token", "expiresAt"}` (the pad's
expiry from the server). Every page load removes entries whose pad expired more than an hour ago (the hour keeps a
device clock that runs fast from dropping the token of a live pad) and entries in any other format. An entry is
also removed when the pad is ended, found expired or not found.

## Heartbeat

- The only text frames. While the tab is visible, the client sends the text frame `ping` every 25 s
  (`HEARTBEAT_INTERVAL_MS`). The answer is the text frame `pong`. Both are fixed strings with no content.
- The Durable Object registers the pair with `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping",
"pong"))`. The Cloudflare runtime answers it itself: the object is not woken from hibernation, `webSocketMessage`
  never runs (so pings don't count towards the 40/s rate limit), nothing is stored or logged. Cloudflare's pricing
  page: auto-responses "will not incur additional wall-clock time, and so they will not be charged".
- If no `pong` arrives within 10 s of a ping (`HEARTBEAT_TIMEOUT_MS`), the client treats the connection as dead:
  it shows the offline banner, closes the socket with `1000` and reconnects with the usual backoff. Only a
  `pong` counts as proof; other frames could still arrive on a link whose upload direction is dead.
- Hidden tabs don't ping (no cost for idle background tabs). When a tab becomes visible again it pings at once,
  since that is when a connection (e.g. after a phone slept) is most likely dead. Worst case while visible, a
  dead connection is noticed after 35 s; after becoming visible, after 10 s.
- The browser's `offline` event gives up on the connection at once (banner shown). While `navigator.onLine` is
  false the client does not retry (it checks again every 10 s); the `online` event reconnects at once with the
  backoff reset.

## Limits

- **Peers:** at most 50 open sockets per pad. The 51st is accepted, sent `ERROR`, and closed with `4009`.
- **Rate:** at most 40 messages per socket in any sliding 1 s window (tracked in the socket attachment, so it
  survives hibernation). The 41st closes the socket with `4008`; clients reconnect with backoff.
- **Stored bytes:** an `UPDATE` that would take the stored rows over 5 MB is neither stored nor relayed, and its
  sender is closed with `4013`. Other clients are unaffected.
- **Edit size (client):** a local change whose Yjs update would not fit one `UPDATE` frame (after the type byte,
  IV, tag and a 4 KB safety margin) is blocked in the editor before it reaches the Y.Doc, and a message is shown.
  This covers typing, paste, and Yjs undo/redo (which edit the Y.Doc directly, so the undo manager is checked
  separately). Online, pending batched edits are flushed before a change that would overflow the batch. Offline,
  the unsent backlog counts against the budget, because it is resent as one diff on reconnect.
- **Origin:** the WebSocket upgrade, `POST /api/pads` and the End now endpoint need an `Origin` whose host equals the request host (any `localhost` port is
  also allowed when `ALLOW_TEST_TTL === "1"`). A missing, malformed or `null` Origin fails too. Otherwise: `ERROR` + `4003` on the WebSocket, `403` on the POST endpoints.
- **Quota:** if a storage write fails, the server sends `ERROR` 5 and closes with `4005`. Cloudflare does not
  document a distinguishable error for free-plan daily limits, so any write failure counts. `POST /api/pads`
  returns `503` in the same case.

## Compaction

1. After storing an `UPDATE` as row `seq`, if the pad has more than 300 rows, or more than 1 MB in the rows after
   the oldest one (the base snapshot), the server sends `COMPACT_REQUEST(seq)` to the socket that wrote that row
   and records `seq` in the socket's attachment. While a request is unanswered, no other is sent for 10 s (then
   it is made again, possibly to another client); once a snapshot has been applied, the next request may go out
   at once.
2. The client captures the document state immediately (it has applied every row up to `seq`: its own rows, plus
   everything received before the request, in order), encrypts it like any document payload (`Purpose.Doc`), and
   sends `SNAPSHOT(seq, data)`. The state is taken from a fresh copy of the document (`compactState`), where Yjs
   garbage-collects the content of deleted text; the live document keeps it for undo. So a snapshot is about the
   size of the current text, however much was pasted and deleted before.
3. The server accepts it only from the socket that was asked, for exactly that `seq`, once. If the oldest stored
   row is already at `seq` or later (a newer snapshot landed first), it is stale and ignored. Otherwise, in one
   transaction: delete rows `seq ≤ upToSeq`, then insert the snapshot at `seq = upToSeq`. Rows with
   `seq > upToSeq` that arrived meanwhile are untouched; the snapshot may duplicate some of them, which Yjs ignores.
4. The snapshot becomes the first row, so it is also the key check for later joiners.

## HTTP status codes

- `POST /api/pads` needs `Content-Type: application/json` (`415` otherwise) and a body of at most 1 KB shaped
  `{ "ttl": <allowed number> }` (`400` otherwise). Replies: `201`, `400`, `403` bad Origin, `415`, `503`.
- A known route with the wrong method answers `405` with an `Allow` header: pages allow `GET, HEAD`, `/ws/<id>`
  allows `GET`, the two POST endpoints allow `POST`. Unknown paths and invalid pad IDs answer `404`.
- Error bodies are fixed short strings; they never echo input.

## Expiry and End now

- The alarm is set to `expiresAt` at creation. `alarm()` and End now both call `deleteAll()` (which also deletes
  the alarm at compatibility date ≥ 2026-02-24), then send `ERROR` and close every socket with `4001`.
- `expires_at` is also checked on every connect, message and End now request, so a late alarm changes nothing:
  an expired pad is deleted on first touch and treated as not found.
- If deletion fails at expiry (e.g. quota), sockets are still closed and the alarm is re-armed 10 minutes later.
- `POST /api/pads/<padId>/end` with `Authorization: Bearer <adminToken>`: `204` ended, `401` missing or wrong token
  (SHA-256 hashes compared with `crypto.subtle.timingSafeEqual`), `404` unknown or expired pad, `503` busy.
