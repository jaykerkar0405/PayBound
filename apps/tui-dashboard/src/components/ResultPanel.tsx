import React from "react";
import { Box, Text } from "ink";
import type { DashboardState } from "../state.js";

/**
 * Panel 5 — derived from the two independent track outcomes
 * (`state.scenarioOutcome`, the security-relevant agent scenario, and
 * `state.x402Outcome`, the separate x402 gated-content purchase) via
 * state.ts's `deriveOverallOutcome`, not from a single last-write-wins
 * field. A failure in either track is shown as an overall failure
 * regardless of what the other track did or which order the two stages'
 * events arrived in — the x402 leg always runs after the scenario stage
 * in the real script, so a scenario failure can no longer be visually
 * overwritten by an unrelated, later x402 success (the audit's finding).
 * This is deliberately the last thing rendered in App.tsx, so it is the
 * last thing on screen when recording stops.
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
    // Combined context: name which of the two independent stages actually
    // failed, and — since the other stage may well have succeeded anyway
    // (they're independent) — say so too, rather than letting a viewer
    // wonder whether the whole run silently did nothing.
    const scenarioFailed = state.scenarioOutcome?.status === "failed";
    const x402Failed = state.x402Outcome?.status === "failed";
    const failedLabel =
      scenarioFailed && x402Failed
        ? "Both the agent scenario and the x402 purchase failed"
        : scenarioFailed
          ? "The security-relevant agent scenario failed"
          : x402Failed
            ? "The x402 purchase failed"
            : "Run did not complete";
    const otherSucceededNote =
      scenarioFailed && state.x402Outcome?.status === "succeeded"
        ? `Note: the independent x402 purchase leg completed successfully afterward (tx: ${state.x402Outcome.result?.hederaTransactionId ?? "n/a"}) — this does not change the scenario's own failure above.`
        : x402Failed && state.scenarioOutcome?.status === "succeeded"
          ? "Note: the agent scenario itself completed successfully before the x402 leg failed."
          : undefined;

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">
          {failedLabel}
        </Text>
        <Text>{state.errorMessage ?? "unknown error — see the event log above"}</Text>
        {otherSucceededNote ? <Text dimColor>{otherSucceededNote}</Text> : null}
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
