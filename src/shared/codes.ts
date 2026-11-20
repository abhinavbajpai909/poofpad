export const CloseCode = {
  UnsupportedData: 1003,
  Expired: 4001,
  BadOrigin: 4003,
  NotFound: 4004,
  ServiceBusy: 4005,
  RateLimited: 4008,
  PadFull: 4009,
  TooLarge: 4013,
} as const;

export type ErrorCloseCode = Exclude<(typeof CloseCode)[keyof typeof CloseCode], 1003>;

const ERROR_CLOSE_CODES: ReadonlySet<number> = new Set(
  Object.values(CloseCode).filter((code) => code >= 4000),
);

/** The `ERROR` frame carries `closeCode - 4000` as one byte (e.g. 5 = service busy). */
export const ERROR_CODE_BASE = 4000;

export function isErrorCloseCode(code: number): code is ErrorCloseCode {
  return ERROR_CLOSE_CODES.has(code);
}
