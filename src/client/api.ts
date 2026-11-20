export interface CreatedPad {
  padId: string;
  adminToken: string;
  expiresAt: number;
}

function isCreatedPad(value: unknown): value is CreatedPad {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { padId, adminToken, expiresAt } = value as Record<string, unknown>;
  return (
    typeof padId === "string" && typeof adminToken === "string" && typeof expiresAt === "number"
  );
}

export async function createPad(ttlSeconds: number): Promise<CreatedPad> {
  const response = await fetch("/api/pads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: ttlSeconds }),
  });
  if (!response.ok) {
    throw new Error("create failed");
  }
  const body: unknown = await response.json();
  if (!isCreatedPad(body)) {
    throw new Error("create failed");
  }
  return body;
}
