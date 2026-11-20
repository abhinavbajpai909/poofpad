# PoofPad wire protocol

Binary WebSocket frames on `GET /ws/<padId>`. The first byte is the frame type; the rest is the payload.
All encrypted payloads are `iv (12 bytes) || AES-GCM ciphertext`, with a fresh random IV per message.

| Type              | Value | Direction   | Payload                                                | Stored?                   |
| ----------------- | ----- | ----------- | ------------------------------------------------------ | ------------------------- |
| `UPDATE`          | 1     | C→S→others  | encrypted Yjs update                                   | yes, 1 row                |
| `AWARENESS`       | 2     | C→S→others  | encrypted awareness update                             | no                        |
| `SYNC_ALL`        | 3     | S→C on join | all stored rows, length-prefixed                       | —                         |
| `COMPACT_REQUEST` | 4     | S→one C     | uint32 `upToSeq`                                       | —                         |
| `SNAPSHOT`        | 5     | C→S         | uint32 `upToSeq` + encrypted `Y.encodeStateAsUpdate`   | replaces rows ≤ `upToSeq` |
| `INFO`            | 6     | S→C         | JSON `{ peers, expiresAt }` on join and on peer change | —                         |
| `ERROR`           | 7     | S→C         | uint8 `closeCode − 4000`, then close with `closeCode`  | —                         |

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

`1003` (unsupported data) is also used when a client sends a text frame, an unknown frame type, or a
server-to-client frame type.

## Encodings

- Integers are big-endian.
- `SYNC_ALL` payload: zero or more rows, each `uint32 length || row bytes`, in `seq` order. A new pad sends an
  empty payload. Server→client frames have no size cap.
- Client→server frames are capped at **1 MB** (`MAX_FRAME_BYTES`, including the type byte). `SNAPSHOT` is the
  exception: up to 5 MB + 5 bytes (`MAX_SNAPSHOT_FRAME_BYTES`), because it replaces stored rows and can be as large
  as the whole pad. Both are far below the Durable Object limits (8 MB per SQLite row/BLOB, 32 MiB per WebSocket
  message). An oversize frame closes the socket with `4013`.
- `COMPACT_REQUEST` payload: `uint32 upToSeq` (≥ 1).
- `SNAPSHOT` payload: `uint32 upToSeq || encrypted Y.encodeStateAsUpdate(doc)` (data must be non-empty).
- `ERROR` payload: one byte, `closeCode − 4000` (e.g. `5` = service busy, `13` = too large). The server then
  closes with that close code. Clients prefer the `ERROR` code over the close code, in case a proxy rewrites it.
- `INFO` payload: UTF-8 JSON `{ "peers": <int>, "expiresAt": <unix ms> }`. `peers` counts open sockets
  including the receiver.

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
   Yjs snapshot: state vector + delete set), it sends one `UPDATE` with exactly the missing part.
4. Local edits are merged for 250 ms (`Y.mergeUpdates`) and sent as one `UPDATE`; the server stores it as one row
   and relays it unchanged to the other sockets.
5. Awareness is throttled to one frame per 250 ms and relayed, never stored. When `INFO.peers` increases, every
   client re-announces its awareness state so the newcomer sees existing cursors. On `pagehide` a client sends
   its awareness as `null`.
6. On close the server broadcasts a new `INFO`. Clients reconnect with backoff (0.5 s doubling to 10 s, jittered)
   unless the close code is terminal (any `4xxx` except `4008`, or `1003`).

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
   and records `seq` in the socket's attachment. At most one request per 10 s per pad; an unanswered request is
   simply made again later, possibly to another client.
2. The client captures `Y.encodeStateAsUpdate(doc)` immediately (it has applied every row up to `seq`: its own
   rows, plus everything received before the request, in order), encrypts it like any document payload
   (`Purpose.Doc`), and sends `SNAPSHOT(seq, data)`.
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
