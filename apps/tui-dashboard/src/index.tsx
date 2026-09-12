#!/usr/bin/env node
/**
 * PayBound TUI Dashboard (Task 6.x) — entry point.
 *
 * Usage (from apps/tui-dashboard/, sized to an 80-100 column terminal —
 * see README.md):
 *   pnpm dev
 *
 * Dev/testing only — replays a captured log instead of spawning a real run:
 *   pnpm dev -- --replay /path/to/captured.log
 */
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

const replayFlagIndex = process.argv.indexOf("--replay");
const replayFile = replayFlagIndex !== -1 ? process.argv[replayFlagIndex + 1] : undefined;

// Belt-and-suspenders: a bug in this display-only layer should never take
// down the terminal with a raw stack trace mid-recording. It also can never
// affect the e2e:live process itself (see runner.ts) — that process has its
// own independent stdio and lifecycle.
process.on("uncaughtException", (err) => {
  console.error("[tui-dashboard] uncaught error (display-only):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[tui-dashboard] unhandled rejection (display-only):", err);
});

// Clear terminal screen and place cursor at top-left so the TUI starts at the very top of the window
process.stdout.write("\x1b[2J\x1b[H");

const { unmount, waitUntilExit } = render(<App replayFile={replayFile} />);

process.on("SIGINT", () => {
  unmount();
  process.stdout.write("\x1b[?25h\n");
  process.exit(0);
});

await waitUntilExit();
process.stdout.write("\x1b[?25h\n");
