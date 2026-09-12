import React from "react";
import { Box, Text } from "ink";
import type { DashboardState } from "../state.js";

/**
 * Panel 5 — set from either a `final_result` or an `x402_purchase_result`
 * event (whichever is chronologically later is what's shown — the x402
 * purchase stage runs after the original attest->hcs scenario, so its
 * outcome is the true final state of the run). A later `run_error` clears
 * `finalResult` so a real failure can't stay masked behind an earlier
 * latched success (see state.ts's reducer). Otherwise it stays on screen
 * for the rest of the process's life. This is deliberately the last thing
 * rendered in App.tsx, so it is the last thing on screen when recording
 * stops.
 */
export function ResultPanel({ state }: { state: DashboardState }): React.JSX.Element | null {
  if (state.finalResult) {
    const r = state.finalResult;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={r.paid ? "green" : "red"} paddingX={1}>
        <Text bold color={r.paid ? "green" : "red"}>
          Final result — paid: {String(r.paid)}
        </Text>
        {r.hederaTransactionId ? <Text>Hedera transaction: {r.hederaTransactionId}</Text> : null}
        {r.status ? <Text>Status: {r.status}</Text> : null}
        {r.hcsSequenceNumber !== undefined ? <Text>HCS sequence #: {r.hcsSequenceNumber}</Text> : null}
        {r.hashscanUrl ? <Text dimColor>{r.hashscanUrl}</Text> : null}
      </Box>
    );
  }

  if (state.phase === "failed") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">
          Run did not complete
        </Text>
        <Text>{state.errorMessage ?? "unknown error — see the event log above"}</Text>
      </Box>
    );
  }

  if (state.phase === "exited") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">
          e2e:live process exited before reporting a final result
        </Text>
      </Box>
    );
  }

  return null;
}
