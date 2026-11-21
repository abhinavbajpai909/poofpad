export const PAD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const MAX_PEERS_PER_PAD = 50;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_STORED_BYTES_PER_PAD = 5 * 1024 * 1024;
/** A SNAPSHOT replaces stored rows, so it may be as large as the whole pad plus its type byte and `upToSeq`. */
export const MAX_SNAPSHOT_FRAME_BYTES = MAX_STORED_BYTES_PER_PAD + 5;
export const MAX_MESSAGES_PER_SECOND = 40;
export const RATE_WINDOW_MS = 1000;
export const MAX_JSON_BODY_BYTES = 1024;

export const ALLOWED_TTLS_SECONDS: readonly number[] = [600, 3600, 21600, 86400];
export const TEST_TTL_SECONDS = 15;

export const UPDATE_BATCH_MS = 250;
export const AWARENESS_THROTTLE_MS = 250;

export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 10_000;

/** Compaction starts when there are more rows than this ... */
export const COMPACT_MAX_ROWS = 300;
/** ... or when the rows after the oldest one (the base snapshot) hold more bytes than this. */
export const COMPACT_MAX_BYTES = 1024 * 1024;
/** A COMPACT_REQUEST that got no SNAPSHOT is sent again (to the next writer) after this long. */
export const COMPACT_RETRY_MS = 10_000;
/** If deleting an expired pad fails (e.g. free-plan quota), the alarm tries again after this long. */
export const BURN_RETRY_MS = 10 * 60_000;

/** While the tab is visible, the client sends a heartbeat ping this often ... */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** ... and treats the connection as dead if the pong has not arrived this long after the ping. */
export const HEARTBEAT_TIMEOUT_MS = 10_000;
