/** The unit-test project has no DOM types; this is the part of `localStorage` the client modules under test use. */
interface Storage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

declare const localStorage: Storage;
