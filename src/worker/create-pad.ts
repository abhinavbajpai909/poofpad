import { ALLOWED_TTLS_SECONDS, MAX_JSON_BODY_BYTES, TEST_TTL_SECONDS } from "../shared/limits";
import { badRequest, json, readJsonBody } from "./http";
import { randomBase64Url, sha256Hex } from "./tokens";

const PAD_ID_BYTES = 16;
const ADMIN_TOKEN_BYTES = 32;

function parseTtl(body: unknown, allowTestTtl: boolean): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "ttl") {
    return null;
  }
  const { ttl } = body as { ttl: unknown };
  if (typeof ttl !== "number") {
    return null;
  }
  if (ALLOWED_TTLS_SECONDS.includes(ttl) || (allowTestTtl && ttl === TEST_TTL_SECONDS)) {
    return ttl;
  }
  return null;
}

export async function createPad(request: Request, env: Env): Promise<Response> {
  const ttl = parseTtl(
    await readJsonBody(request, MAX_JSON_BODY_BYTES),
    env.ALLOW_TEST_TTL === "1",
  );
  if (ttl === null) {
    return badRequest();
  }
  const padId = randomBase64Url(PAD_ID_BYTES);
  const adminToken = randomBase64Url(ADMIN_TOKEN_BYTES);
  const expiresAt = await env.PAD.getByName(padId).create(ttl, await sha256Hex(adminToken));
  if (expiresAt === null) {
    throw new Error("pad id collision");
  }
  return json({ padId, adminToken, expiresAt }, 201);
}
