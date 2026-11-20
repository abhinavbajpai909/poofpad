import { PAD_ID_PATTERN } from "../shared/limits";
import { createPad } from "./create-pad";
import { internalError, notFound, serveAppShell, upgradeRequired } from "./http";

export { Pad } from "./pad";

function isValidPadId(padId: string | undefined): padId is string {
  return padId !== undefined && PAD_ID_PATTERN.test(padId);
}

function connectToPad(request: Request, env: Env, padId: string): Promise<Response> | Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return upgradeRequired();
  }
  return env.PAD.getByName(padId).fetch(request);
}

function route(request: Request, env: Env): Promise<Response> | Response {
  const segments = new URL(request.url).pathname.split("/").slice(1);
  const [head, second, ...rest] = segments;
  const method = request.method;

  switch (head) {
    case "privacy":
      return segments.length === 1 && method === "GET" ? serveAppShell(request, env) : notFound();
    case "p":
      return isValidPadId(second) && rest.length === 0 && method === "GET"
        ? serveAppShell(request, env)
        : notFound();
    case "ws":
      return isValidPadId(second) && rest.length === 0 && method === "GET"
        ? connectToPad(request, env, second)
        : notFound();
    case "api":
      return second === "pads" && rest.length === 0 && method === "POST"
        ? createPad(request, env)
        : notFound();
    default:
      return notFound();
  }
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      // eslint-disable-next-line no-console
      console.error("internal error");
      return internalError();
    }
  },
} satisfies ExportedHandler<Env>;
