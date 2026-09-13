import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * Regression test for a real crash this route had: connecting to a run
 * that has ALREADY finished (e.g. one that fails within milliseconds of
 * starting) made `subscribeToRun` call `onDone` SYNCHRONOUSLY, before the
 * `heartbeat = setInterval(...)` line below it ever ran — scheduling a
 * heartbeat AFTER the stream's controller was already closed. 15s later,
 * that heartbeat fired and threw an uncaught `ERR_INVALID_STATE` from
 * `controller.enqueue()` on a closed controller, which crashes the whole
 * Node process (nothing catches a synchronous throw inside a `setInterval`
 * callback). This was hit for real while testing the scenario-selector
 * feature locally — this test exists so it can't silently come back.
 *
 * Mocks `$lib/server/run-manager.js` to replicate exactly that ordering
 * (`subscribeToRun` invoking `onDone` before returning) without needing a
 * real spawned process.
 *
 * Detection mechanism: the fix guards `setInterval(...)` with
 * `if (closed) return;`, so for an already-finished run the heartbeat is
 * never scheduled at all. We spy on `setInterval` and assert it was never
 * called — a direct, reliable signal in the vitest environment (vitest's
 * fake-timer engine internally catches errors thrown inside timer callbacks,
 * so the original `uncaughtException`-based strategy did not actually
 * detect the bug).
 */

const getRunSnapshot = vi.fn();
const subscribeToRun = vi.fn();

vi.mock("$lib/server/run-manager.js", () => ({
  getRunSnapshot: (...args: unknown[]) => getRunSnapshot(...args),
  subscribeToRun: (...args: unknown[]) => subscribeToRun(...args),
}));

async function importRoute() {
  return import("../routes/api/run/[id]/stream/+server.js");
}

function fakeRequest(lastEventId?: string): Request {
  const headers = new Headers();
  if (lastEventId !== undefined) headers.set("last-event-id", lastEventId);
  return new Request("http://localhost/api/run/r1/stream", { headers });
}

describe("GET /api/run/[id]/stream — already-finished run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not schedule a heartbeat when the run was already finished (closed-flag guard)", async () => {
    // Replicates run-manager.ts's real behavior for a run that is no
    // longer "running": subscribeToRun replays nothing new, calls onDone
    // synchronously, and returns a no-op unsubscribe (not undefined) — see
    // run-manager.ts's subscribeToRun doc comment.
    getRunSnapshot.mockReturnValue({ id: "r1", status: "failed", exitCode: 1, lines: [] });
    subscribeToRun.mockImplementation((_id: string, _onLine: unknown, onDone: () => void) => {
      onDone(); // fires SYNCHRONOUSLY — exactly the race condition
      return () => {};
    });

    // Spy on setInterval BEFORE calling GET, so that any call to setInterval
    // inside the route (heartbeat scheduling) is captured.
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const { GET } = await importRoute();
    const response = GET({ params: { id: "r1" }, request: fakeRequest() } as never) as Response;

    // Drain the stream so the "done" event (and any close) actually happens.
    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // The fix: `if (closed) return;` runs before `heartbeat = setInterval(...)`,
    // so setInterval must never have been called for an already-finished run.
    // Without the fix, setInterval IS called — scheduling a heartbeat against
    // an already-closed controller that will throw ERR_INVALID_STATE 15s later.
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("still delivers the done event for an already-finished run", async () => {
    getRunSnapshot.mockReturnValue({ id: "r2", status: "done", exitCode: 0, lines: ["hello"] });
    subscribeToRun.mockImplementation((_id: string, onLine: (line: string, i: number) => void, onDone: () => void) => {
      onLine("hello", 0);
      onDone();
      return () => {};
    });

    const { GET } = await importRoute();
    const response = GET({ params: { id: "r2" }, request: fakeRequest() } as never) as Response;

    const text = await response.text();
    expect(text).toContain("event: line");
    expect(text).toContain("event: done");
    expect(text).toContain('\\"status\\":\\"done\\"');
  });
});
