import { CloseCode } from "../shared/codes";
import { PAD_ID_PATTERN } from "../shared/limits";
import { createPad } from "./create-pad";
import { endPad } from "./end-pad";
import { internalError, notFound, refuseWebSocket, serveAppShell, upgradeRequired } from "./http";
import { isAllowedOrigin } from "./origin";

export { Pad } from "./pad";

function isValidPadId(padId: string | undefined): padId is string {
  return padId !== undefined && PAD_ID_PATTERN.test(padId);
}

function connectToPad(request: Request, env: Env, padId: string): Promise<Response> | Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return upgradeRequired();
  }
  if (!isAllowedOrigin(request, env)) {
    return refuseWebSocket(CloseCode.BadOrigin);
  }
  return env.PAD.getByName(padId).fetch(request);
}

function routeApi(
  request: Request,
  env: Env,
  segments: readonly string[],
): Promise<Response> | Response {
  const [resource, padId, action, ...extra] = segments;
  if (resource !== "pads" || request.method !== "POST" || extra.length > 0) {
    return notFound();
  }
  if (padId === undefined) {
    return createPad(request, env);
  }
  return isValidPadId(padId) && action === "end" ? endPad(request, env, padId) : notFound();
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
      return routeApi(request, env, segments.slice(1));
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
