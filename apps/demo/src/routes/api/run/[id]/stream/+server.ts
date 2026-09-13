import type { RequestHandler } from "./$types.js";
import { subscribeToRun, getRunSnapshot } from "$lib/server/run-manager.js";

/** How often to send an SSE comment during otherwise-silent stretches (e.g. the ~60s Hedera mirror-node settlement poll in e2e-live-demo.ts, which prints nothing per attempt) — well under typical reverse-proxy idle-connection timeouts, so a real production hop in front of this service doesn't drop the connection and force a reconnect. */
const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events stream of one run's raw output lines, in order.
 * Any number of tabs can watch the same run. Sends a final `event: done`
 * message with the run's outcome, then closes.
 *
 * Participates in SSE's standard resumption protocol (each `line` event
 * carries an `id:` — its index in the run's buffer) so that if the
 * connection DOES still drop and the browser's EventSource reconnects, it
 * sends back the last id it saw as a `Last-Event-ID` request header and
 * this resumes from there — NOT a full replay from index 0. A full replay
 * on every reconnect used to re-feed the client's reducer every
 * already-processed stage/log event a second time, which is what caused
 * the pipeline stepper and activity log to visibly flicker backward
 * before catching back up.
 */
export const GET: RequestHandler = ({ params, request }) => {
  const { id } = params;

  if (getRunSnapshot(id) === undefined) {
    return new Response("run not found", { status: 404 });
  }

  const lastEventId = request.headers.get("last-event-id");
  const fromIndex = lastEventId !== null && /^\d+$/.test(lastEventId) ? Number(lastEventId) + 1 : 0;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string, id?: number) => {
        const idField = id !== undefined ? `id: ${id}\n` : "";
        controller.enqueue(encoder.encode(`${idField}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const onLine = (line: string, index: number) => send("line", line, index);
      const onDone = () => {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        const snapshot = getRunSnapshot(id);
        send("done", JSON.stringify({ status: snapshot?.status, exitCode: snapshot?.exitCode }));
        controller.close();
      };

      unsubscribe = subscribeToRun(id, onLine, onDone, fromIndex);
      if (unsubscribe === undefined) {
        // Run existed at the getRunSnapshot check above but vanished
        // (pruned) in the meantime — vanishingly unlikely, but close
        // cleanly rather than hang the connection open.
        controller.close();
        return;
      }

      // A comment line (":...") is ignored by EventSource's message/
      // named-event listeners entirely, but still counts as traffic to
      // whatever idle-connection timeout sits in front of this service.
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};
