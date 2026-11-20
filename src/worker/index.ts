import { PAD_ID_PATTERN } from "../shared/limits";
import { notFound, serveAppShell } from "./http";

export { Pad } from "./pad";

function route(request: Request, env: Env): Promise<Response> | Response {
  const segments = new URL(request.url).pathname.split("/").slice(1);
  const [head, padId, ...rest] = segments;

  switch (head) {
    case "privacy":
      return segments.length === 1 && request.method === "GET"
        ? serveAppShell(request, env)
        : notFound();
    case "p":
      return padId !== undefined &&
        PAD_ID_PATTERN.test(padId) &&
        rest.length === 0 &&
        request.method === "GET"
        ? serveAppShell(request, env)
        : notFound();
    default:
      return notFound();
  }
}

export default {
  fetch(request, env) {
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
