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
