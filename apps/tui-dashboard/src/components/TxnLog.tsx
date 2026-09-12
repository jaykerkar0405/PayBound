import React from "react";
import { Box, Text } from "ink";
import type { DashboardState, TxLogEntry } from "../state.js";

/**
 * Transaction Registry & HashScan Audit Panel.
 * Clean 2-line per transaction display:
 * Line 1: Badge, Label, full Hedera Tx ID, and HCS Seq #.
 * Line 2: Tree branch pointer and full clickable HashScan URL.
 */
export function TxnLog({ state }: { state: DashboardState }): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={state.txns.length > 0 ? "green" : "gray"}
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold>TRANSACTION REGISTRY & HASHSCAN AUDIT</Text>
        <Text dimColor>{state.txns.length} CONFIRMED SETTLEMENTS</Text>
      </Box>

      {state.txns.length === 0 ? (
        <Text dimColor>(waiting for Hedera transaction confirmations…)</Text>
      ) : (
        state.txns.map((tx: TxLogEntry, idx: number) => (
          <Box key={tx.id} flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color="green" bold>[✓ 0{idx + 1}]</Text>
              <Text bold>{tx.label}</Text>
              <Text dimColor>• Tx: {tx.id}</Text>
              {tx.sequenceNumber !== undefined ? (
                <Text dimColor>• Seq: {tx.sequenceNumber}</Text>
              ) : null}
            </Box>
            <Box flexDirection="row" paddingLeft={2}>
              <Text dimColor>└─ Explorer: </Text>
              <Text color="green" underline>
                {tx.url}
              </Text>
            </Box>
          </Box>
        ))
      )}
    </Box>
  );
}

