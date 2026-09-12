import React from "react";
import { Box, Text } from "ink";
import type { DashboardState } from "../state.js";

function shortHash(str: string): string {
  if (!str) return "";
  return str.length > 28 ? `${str.slice(0, 16)}…` : str;
}

/**
 * Right Column: Settlement & Run State.
 * Displays live run metadata, scenario, full Hedera settlement transaction ID,
 * and HCS audit consensus status. Always rendered to maintain layout stability.
 * Full transaction IDs without truncation.
 */
export function ResultPanel({ state, width }: { state: DashboardState; width?: number }): React.JSX.Element {
  const result = state.finalResult ?? state.x402Outcome?.result ?? state.scenarioOutcome?.result;
  const isSucceeded = state.phase === "succeeded";
  const isFailed = state.phase === "failed" || state.phase === "exited";
  const txId = result?.hederaTransactionId;
  const hcsSeq = state.scenarioOutcome?.result?.hcsSequenceNumber ?? state.finalResult?.hcsSequenceNumber;

  const borderColor = isFailed ? "red" : isSucceeded ? "green" : "gray";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      width={width}
    >
      <Box justifyContent="space-between">
        <Text bold>SETTLEMENT & RUN STATE</Text>
        {isSucceeded ? (
          <Text color="green" bold>[✓ SETTLED]</Text>
        ) : isFailed ? (
          <Text color="red" bold>[✗ FAILED]</Text>
        ) : state.phase === "waiting" ? (
          <Text dimColor>[STANDBY]</Text>
        ) : (
          <Text inverse bold>{" "}SYNCING{" "}</Text>
        )}
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor>Scenario:</Text>
        <Text bold>{state.scenario ?? "live-demo"}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>Task Hash:</Text>
        <Text>{state.taskHash ? shortHash(state.taskHash) : "(seeding…)"}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>Hedera Tx:</Text>
        <Text bold={Boolean(txId)}>{txId ? txId : "(pending…)"}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>HCS Seq #:</Text>
        <Text>{hcsSeq !== undefined ? String(hcsSeq) : "(pending…)"}</Text>
      </Box>

      <Box justifyContent="space-between">
        <Text bold underline>STATUS:</Text>
        {isSucceeded ? (
          <Text color="green" bold>✓ MIRROR CONFIRMED</Text>
        ) : isFailed ? (
          <Text color="red" bold wrap="truncate-end">✗ {state.errorMessage ? state.errorMessage.slice(0, 20) : "FAILED"}</Text>
        ) : (
          <Text dimColor>● RECONCILING HCS</Text>
        )}
      </Box>
    </Box>
  );
}
