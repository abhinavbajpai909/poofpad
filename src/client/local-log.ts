import * as Y from "yjs";

/**
 * Neighbouring small updates are merged into one entry up to this size, so typing doesn't create an entry per
 * keystroke. Small, because every merge re-reads the entry it extends.
 */
const MERGE_BYTES = 4 * 1024;
/** Entries older than this much in total are dropped (see `missingFrom`). */
export const LOG_MAX_BYTES = 16 * 1024 * 1024;

export interface LocalLog {
  /** Records an update this client made itself. */
  add(update: Uint8Array): void;
  /**
   * Everything the server lacks, as frames of at most `maxBytes` each. The server's state is known exactly from
   * `SYNC_ALL`. Returns null when old entries were dropped, so the log can no longer vouch for completeness.
   */
  missingFrom(server: Y.Doc, maxBytes: number): Uint8Array[] | null;
  /** Forgets entries the server is known to have (it holds them until the pad expires). */
  prune(server: Y.Doc): void;
  /** The server has everything: nothing is missing any more, even what was dropped earlier. */
  clear(): void;
}

/**
 * The updates this client produced, kept as separate pieces. After a dropped connection the server may lack an
 * update that was already sent (lost in flight) as well as everything typed offline. Their combined diff can
 * exceed one frame even though each piece fit one, and an update cannot be cut into smaller ones, so the pieces
 * themselves are what gets resent.
 */
export function createLocalLog(): LocalLog {
  let entries: Uint8Array[] = [];
  let bytes = 0;
  let dropped = false;

  function add(update: Uint8Array): void {
    const last = entries.at(-1);
    if (last !== undefined && last.byteLength + update.byteLength <= MERGE_BYTES) {
      const merged = Y.mergeUpdates([last, update]);
      bytes += merged.byteLength - last.byteLength;
      entries[entries.length - 1] = merged;
    } else {
      entries.push(update);
      bytes += update.byteLength;
    }
    while (bytes > LOG_MAX_BYTES && entries.length > 1) {
      bytes -= entries.shift()?.byteLength ?? 0;
      dropped = true;
    }
  }

  function lacking(server: Y.Doc): Uint8Array[] {
    const known = Y.snapshot(server);
    return entries.filter((entry) => !Y.snapshotContainsUpdate(known, entry));
  }

  function missingFrom(server: Y.Doc, maxBytes: number): Uint8Array[] | null {
    if (dropped) {
      return null;
    }
    const frames: Uint8Array[] = [];
    let group: Uint8Array[] = [];
    let groupBytes = 0;
    for (const entry of lacking(server)) {
      if (group.length > 0 && groupBytes + entry.byteLength > maxBytes) {
        frames.push(Y.mergeUpdates(group));
        group = [];
        groupBytes = 0;
      }
      group.push(entry);
      groupBytes += entry.byteLength;
    }
    if (group.length > 0) {
      frames.push(Y.mergeUpdates(group));
    }
    return frames;
  }

  function prune(server: Y.Doc): void {
    entries = lacking(server);
    bytes = entries.reduce((total, entry) => total + entry.byteLength, 0);
  }

  function clear(): void {
    entries = [];
    bytes = 0;
    dropped = false;
  }

  return { add, missingFrom, prune, clear };
}
