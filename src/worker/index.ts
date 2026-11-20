import { CloseCode } from "../shared/codes";
import { PAD_ID_PATTERN } from "../shared/limits";
import { createPad } from "./create-pad";
import { endPad } from "./end-pad";
import {
  forbidden,
  internalError,
  methodNotAllowed,
  notFound,
  refuseWebSocket,
  serveAppShell,
  upgradeRequired,
} from "./http";
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
  const creates = resource === "pads" && padId === undefined;
  const ends = resource === "pads" && isValidPadId(padId) && action === "end" && extra.length === 0;
  if (!creates && !ends) {
    return notFound();
  }
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  if (!isAllowedOrigin(request, env)) {
    return forbidden();
  }
  return creates ? createPad(request, env) : endPad(request, env, padId as string);
}

function routePage(request: Request, env: Env): Promise<Response> | Response {
  return request.method === "GET" || request.method === "HEAD"
    ? serveAppShell(request, env)
    : methodNotAllowed("GET, HEAD");
}

function route(request: Request, env: Env): Promise<Response> | Response {
  const segments = new URL(request.url).pathname.split("/").slice(1);
  const [head, second, ...rest] = segments;

  switch (head) {
    case "privacy":
      return segments.length === 1 ? routePage(request, env) : notFound();
    case "p":
      return isValidPadId(second) && rest.length === 0 ? routePage(request, env) : notFound();
    case "ws":
      if (!isValidPadId(second) || rest.length > 0) {
        return notFound();
      }
      return request.method === "GET"
        ? connectToPad(request, env, second)
        : methodNotAllowed("GET");
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
