import type { RequestHandler } from "./$types.js";
import { subscribeToRun, getRunSnapshot } from "$lib/server/run-manager.js";

/**
 * Server-Sent Events stream of one run's raw output lines, in order,
 * starting from the beginning regardless of when the browser connects
 * (subscribeToRun replays everything buffered so far first) — any number
 * of tabs can watch the same run. Sends a final `event: done` message with
 * the run's outcome, then closes.
 */
export const GET: RequestHandler = ({ params }) => {
  const { id } = params;

  if (getRunSnapshot(id) === undefined) {
    return new Response("run not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const onLine = (line: string) => send("line", line);
      const onDone = () => {
        const snapshot = getRunSnapshot(id);
        send("done", JSON.stringify({ status: snapshot?.status, exitCode: snapshot?.exitCode }));
        controller.close();
      };

      unsubscribe = subscribeToRun(id, onLine, onDone);
      if (unsubscribe === undefined) {
        // Run existed at the getRunSnapshot check above but vanished
        // (pruned) in the meantime — vanishingly unlikely, but close
        // cleanly rather than hang the connection open.
        controller.close();
      }
    },
    cancel() {
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
