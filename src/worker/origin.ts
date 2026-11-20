/**
 * Browser-made requests (WebSocket upgrades and the POST endpoints) must come from a page on this host.
 * A missing or unparsable `Origin` is refused. In test mode (`ALLOW_TEST_TTL === "1"`) any `localhost`
 * port is also allowed, for the Vite dev server and Playwright.
 */
export function isAllowedOrigin(request: Request, env: Env): boolean {
  const header = request.headers.get("Origin");
  if (header === null || !URL.canParse(header)) {
    return false;
  }
  const origin = new URL(header);
  if (origin.host === new URL(request.url).host) {
    return true;
  }
  return env.ALLOW_TEST_TTL === "1" && origin.hostname === "localhost";
}
