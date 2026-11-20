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
| `ERROR`           | 7     | S→C         | uint8 code, then close                                 | —                         |

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
  empty payload. Client→server frames are capped at `MAX_FRAME_BYTES`; server→client frames are not.
- `INFO` payload: UTF-8 JSON `{ "peers": <int>, "expiresAt": <unix ms> }`. `peers` counts open sockets
  including the receiver.

## Encryption

- Pad URL: `/p/<padId>#<key>`. `key` is 32 random bytes as unpadded, canonical base64url (43 chars). Browsers
  never send the fragment to a server, and the WebSocket URL is built from the host and `padId` only.
- The key is imported with WebCrypto as a non-extractable AES-GCM 256 key. A missing or malformed key shows
  the "This link is incomplete" screen and opens no socket.
- Every `UPDATE`, `AWARENESS` and `SNAPSHOT` payload (and so every stored row) is
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

1. Client opens `GET /ws/<padId>`. Unknown or expired pad → socket accepted then closed with `4004`.
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
