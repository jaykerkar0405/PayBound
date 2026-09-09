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
    // Wires up Speculos auto-approval (task 3.2) — see that file's doc
    // comment. Relies on `isolate: false` above to run its top-level
    // connectivity check/poller setup exactly once per `vitest run`, not
    // once per test file.
    setupFiles: ["./src/__tests__/setup.speculos.ts"],
  },
});
