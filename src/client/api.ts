export interface CreatedPad {
  padId: string;
  adminToken: string;
  expiresAt: number;
}

export type CreateResult = { ok: true; pad: CreatedPad } | { ok: false; busy: boolean };

export type EndResult = "ended" | "unauthorized" | "notFound" | "busy" | "failed";

const SERVICE_UNAVAILABLE = 503;

function isCreatedPad(value: unknown): value is CreatedPad {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { padId, adminToken, expiresAt } = value as Record<string, unknown>;
  return (
    typeof padId === "string" && typeof adminToken === "string" && typeof expiresAt === "number"
  );
}

export async function createPad(ttlSeconds: number): Promise<CreateResult> {
  const response = await fetch("/api/pads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: ttlSeconds }),
  });
  if (!response.ok) {
    return { ok: false, busy: response.status === SERVICE_UNAVAILABLE };
  }
  const body: unknown = await response.json();
  return isCreatedPad(body) ? { ok: true, pad: body } : { ok: false, busy: false };
}

export async function endPad(padId: string, adminToken: string): Promise<EndResult> {
  const response = await fetch(`/api/pads/${padId}/end`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  switch (response.status) {
    case 204:
      return "ended";
    case 401:
      return "unauthorized";
    case 404:
      return "notFound";
    case SERVICE_UNAVAILABLE:
      return "busy";
    default:
      return "failed";
  }
}
