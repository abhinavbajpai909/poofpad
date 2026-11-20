function storageKey(padId: string): string {
  return `admin:${padId}`;
}

export function rememberAdminToken(padId: string, token: string): void {
  try {
    localStorage.setItem(storageKey(padId), token);
  } catch {
    return;
  }
}

export function readAdminToken(padId: string): string | null {
  try {
    return localStorage.getItem(storageKey(padId));
  } catch {
    return null;
  }
}

export function forgetAdminToken(padId: string): void {
  try {
    localStorage.removeItem(storageKey(padId));
  } catch {
    return;
  }
}
