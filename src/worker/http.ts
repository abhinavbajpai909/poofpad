import type { ErrorCloseCode } from "../shared/codes";
import { FrameType, encodeError, encodeFrame } from "../shared/protocol";

/** Sent with every response the app produces; `public/_headers` repeats it for assets the platform serves directly. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), clipboard-write=(self)",
};

function secureHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ ...SECURITY_HEADERS, "Cache-Control": "no-store", ...extra });
}

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: secureHeaders({ "Content-Type": "text/plain; charset=utf-8", ...extra }),
  });
}

export function notFound(): Response {
  return text("Not found", 404);
}

export function badRequest(): Response {
  return text("Bad request", 400);
}

export function unauthorized(): Response {
  return text("Unauthorized", 401);
}

export function forbidden(): Response {
  return text("Forbidden", 403);
}

export function methodNotAllowed(allow: string): Response {
  return text("Method not allowed", 405, { Allow: allow });
}

export function unsupportedMediaType(): Response {
  return text("Unsupported media type", 415);
}

export function serviceBusy(): Response {
  return text("Service busy", 503);
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: secureHeaders() });
}

/** Browsers ignore headers on a WebSocket handshake, but every response the app builds carries them. */
export function acceptWebSocket(client: WebSocket): Response {
  return new Response(null, { status: 101, webSocket: client, headers: secureHeaders() });
}

/** Completes a WebSocket upgrade only to send `ERROR` and close: browsers can't read an HTTP error status. */
export function refuseWebSocket(code: ErrorCloseCode): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.accept();
  server.send(encodeFrame(FrameType.Error, encodeError(code)));
  server.close(code, "refused");
  return acceptWebSocket(client);
}

export function upgradeRequired(): Response {
  return text("Upgrade required", 426);
}

export function internalError(): Response {
  return text("Internal error", 500);
}

export function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: secureHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

/** The HTML shell from static assets, with the security headers added. It revalidates on every load. */
export async function serveAppShell(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new URL("/index.html", request.url));
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  response.headers.set("Cache-Control", "no-cache, no-transform");
  if (new URL(request.url).pathname.startsWith("/p/")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (request.body === null) {
    return undefined;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return undefined;
  }
}
