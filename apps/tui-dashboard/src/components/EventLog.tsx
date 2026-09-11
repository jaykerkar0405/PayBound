import React from "react";
import { Box, Text } from "ink";
import type { DashboardState } from "../state.js";

/**
 * Panel 4 — a bounded, rolling window (see state.ts's `pushLog`, capped at
 * the last 10 lines) of real [AUDIT]/stage events with timestamps implicit
 * in arrival order. Reducer updates append/replace a small fixed-size
 * array, so React/Ink only ever diffs ~10 <Text> nodes per update, not a
 * growing transcript — the update cost stays flat for the whole run.
 */
export function EventLog({ state }: { state: DashboardState }): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text bold>Event log</Text>
      {state.log.length === 0 ? (
        <Text dimColor>(waiting for events…)</Text>
      ) : (
        state.log.map((line) => (
          <Text key={line.id} wrap="truncate-end">
            {line.text}
          </Text>
        ))
      )}
    </Box>
  );
}
