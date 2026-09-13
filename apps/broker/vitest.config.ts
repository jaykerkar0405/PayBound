import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // All broker test files share one real Postgres database (via
    // src/db.ts's pool, DATABASE_URL) with no reset between them — tests
    // rely on fresh randomUUID()s per test, not isolation, to avoid
    // collisions. Kept serial (left over from the pre-Postgres SQLite
    // setup, where separate parallel worker threads meant separate
    // concurrent connections to the same file, which could race even with
    // a busy_timeout set) since nothing has required changing it since —
    // Postgres itself would tolerate real parallel connections fine.
    fileParallelism: false,
    isolate: false,
    // Provisions Speculos automatically (task 1.8 fix) and wires up its
    // auto-approval poller (task 3.2) — see that file's doc comment.
    // `globalSetup` runs exactly once per `vitest run` regardless of
    // `isolate`/`fileParallelism`, unlike `setupFiles`.
    globalSetup: ["./src/__tests__/global-setup.speculos.ts"],
  },
});
