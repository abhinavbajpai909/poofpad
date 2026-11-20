function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function notFound(): Response {
  return text("Not found", 404);
}

export function badRequest(): Response {
  return text("Bad request", 400);
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
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function serveAppShell(request: Request, env: Env): Promise<Response> {
  return env.ASSETS.fetch(new URL("/index.html", request.url));
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
