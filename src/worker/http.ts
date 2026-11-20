export function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function serveAppShell(request: Request, env: Env): Promise<Response> {
  return env.ASSETS.fetch(new URL("/index.html", request.url));
}
