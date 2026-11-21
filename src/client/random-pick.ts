const UINT32_RANGE = 2 ** 32;

/** The largest multiple of `count` that fits in a Uint32 range; draws at or above it would bias `% count`. */
export function rejectionLimit(count: number): number {
  return UINT32_RANGE - (UINT32_RANGE % count);
}

/** Uniform choice by rejection sampling: redraws until the value falls below `rejectionLimit`. */
export function pickWith<T>(items: readonly T[], draw: () => number): T {
  const limit = rejectionLimit(items.length);
  let value = draw();
  while (value >= limit) {
    value = draw();
  }
  return items[value % items.length] as T;
}

function drawUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

export function pick<T>(items: readonly T[]): T {
  return pickWith(items, drawUint32);
}
