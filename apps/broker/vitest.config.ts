import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // All broker test files share one real SQLite file (via src/db.ts) —
    // running them in separate parallel worker threads means separate
    // concurrent connections to that same file, which can race even with a
    // busy_timeout set. Production only ever has one Broker process/one
    // connection, so this is a test-infrastructure constraint, not a
    // behavior we need to support: run this package's test files serially,
    // in one worker, instead.
    fileParallelism: false,
    isolate: false,
    // Provisions Speculos automatically (task 1.8 fix) and wires up its
    // auto-approval poller (task 3.2) — see that file's doc comment.
    // `globalSetup` runs exactly once per `vitest run` regardless of
    // `isolate`/`fileParallelism`, unlike `setupFiles`.
    globalSetup: ["./src/__tests__/global-setup.speculos.ts"],
  },
});
