import { noContent, notFound, serviceBusy, unauthorized } from "./http";
import { ADMIN_TOKEN_PATTERN, sha256Hex } from "./tokens";

const BEARER_PREFIX = "Bearer ";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length);
  return ADMIN_TOKEN_PATTERN.test(token) ? token : null;
}

export async function endPad(request: Request, env: Env, padId: string): Promise<Response> {
  const token = bearerToken(request);
  if (token === null) {
    return unauthorized();
  }
  const result = await env.PAD.getByName(padId).end(await sha256Hex(token));
  switch (result) {
    case "ended":
      return noContent();
    case "unauthorized":
      return unauthorized();
    case "notFound":
      return notFound();
    case "busy":
      return serviceBusy();
  }
}
