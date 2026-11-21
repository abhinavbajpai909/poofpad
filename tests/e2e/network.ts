import type { Page, WebSocketRoute } from "@playwright/test";

export interface SocketControl {
  /** Cuts the live connection (both sides) and refuses new ones until `reconnect()`. */
  drop(): Promise<void>;
  /** Lets the client's next reconnect attempt through to the real server. */
  reconnect(): void;
  /**
   * Half-open connection: the live connection stays open but carries nothing in either direction, the
   * way a dead mobile link often looks. New connections work normally. `drop()` still closes it.
   */
  stall(): void;
  /** Frame types the client sent to the server (first byte of each binary frame). */
  sent: number[];
  /** Frame types the server sent to the client. */
  received: number[];
  /** Size in bytes of each frame in `received`, in the same order. */
  receivedBytes: number[];
  /** Connections opened through the route so far. */
  connections(): number;
  /** Close codes the client sent on stalled connections (it gave up on them). */
  stalledClosedByClient: number[];
}

/** Retryable "abnormal" close; 4xxx codes would be terminal for the client. */
const DROP_CODE = 3000;

function frameType(message: string | Uint8Array): number {
  return typeof message === "string" ? -1 : (message[0] ?? -1);
}

function closeOptions(
  code: number | undefined,
  reason: string | undefined,
): { code?: number; reason?: string } {
  return { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) };
}

/**
 * Puts the page's pad WebSocket behind Playwright's WebSocket routing: every frame is passed through to
 * the real server unchanged, and the test can cut the connection the way a network drop would.
 */
export async function controlSocket(page: Page): Promise<SocketControl> {
  let online = true;
  const live: { client: WebSocketRoute; server: WebSocketRoute; stalled: boolean }[] = [];
  const sent: number[] = [];
  const received: number[] = [];
  const receivedBytes: number[] = [];
  const stalledClosedByClient: number[] = [];
  let connections = 0;
  await page.routeWebSocket(/\/ws\//, (client) => {
    if (!online) {
      void client.close({ code: DROP_CODE, reason: "offline" });
      return;
    }
    connections += 1;
    const server = client.connectToServer();
    const connection = { client, server, stalled: false };
    client.onMessage((message) => {
      sent.push(frameType(message));
      if (!connection.stalled) {
        server.send(message);
      }
    });
    server.onMessage((message) => {
      if (connection.stalled) {
        return;
      }
      received.push(frameType(message));
      receivedBytes.push(message.length);
      client.send(message);
    });
    client.onClose((code, reason) => {
      if (connection.stalled) {
        stalledClosedByClient.push(code ?? 1005);
      }
      void server.close(closeOptions(code, reason));
    });
    server.onClose((code, reason) => void client.close(closeOptions(code, reason)));
    live.push(connection);
  });
  return {
    sent,
    received,
    receivedBytes,
    stalledClosedByClient,
    connections: () => connections,
    async drop() {
      online = false;
      for (const { client, server } of live.splice(0)) {
        await server.close({ code: 1001, reason: "dropped" });
        await client.close({ code: DROP_CODE, reason: "dropped" });
      }
    },
    reconnect() {
      online = true;
    },
    stall() {
      for (const connection of live) {
        connection.stalled = true;
      }
    },
  };
}
