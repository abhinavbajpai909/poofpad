export const PAD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const MAX_PEERS_PER_PAD = 50;
export const MAX_FRAME_BYTES = 256 * 1024;
export const MAX_STORED_BYTES_PER_PAD = 5 * 1024 * 1024;
export const MAX_MESSAGES_PER_SECOND = 40;
export const MAX_JSON_BODY_BYTES = 1024;

export const ALLOWED_TTLS_SECONDS: readonly number[] = [600, 3600, 21600, 86400];
export const TEST_TTL_SECONDS = 15;

export const UPDATE_BATCH_MS = 250;
export const AWARENESS_THROTTLE_MS = 250;

export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 10_000;
