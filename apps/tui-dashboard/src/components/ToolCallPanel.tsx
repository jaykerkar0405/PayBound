import React from "react";
import { Box, Text } from "ink";
import type { DashboardState } from "../state.js";

/**
 * Left Column: Agent Tool Call Inspector.
 * Spotlights the exact moment the agent invokes `pay(capabilityId)`.
 * Clean monochrome styling with strict policy assertion display.
 * Displays FULL capability IDs and payloads without truncation.
 */
export function ToolCallPanel({ state, width }: { state: DashboardState; width?: number }): React.JSX.Element {
  const call = state.lastToolCall;
  const isPayRejected = state.stages.pay === "failed";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isPayRejected ? "red" : "gray"}
      paddingX={1}
      width={width}
    >
      <Box justifyContent="space-between">
        <Text bold>AGENT TOOL DISPATCH</Text>
        {isPayRejected ? (
          <Text color="red" bold>[REJECTED]</Text>
        ) : call ? (
          <Text color="green" bold>[DISPATCHED]</Text>
        ) : (
          <Text dimColor>[AWAITING]</Text>
        )}
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor>Function:</Text>
        <Text bold>pay(capabilityId)</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>Capability:</Text>
        <Text bold={Boolean(call)}>{call ? call.capabilityId : "(pending…)"}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>Payload:</Text>
        <Text>
          {call ? `{"capabilityId": "${call.capabilityId}"}` : "(waiting…)"}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>Timestamp:</Text>
        <Text dimColor>{call?.timestamp ? `${call.timestamp.slice(11, 19)} UTC` : "(standby)"}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text bold underline>POLICY:</Text>
        {isPayRejected ? (
          <Text color="red" bold>Invariant: Clause 7 (REPLAY) enforced</Text>
        ) : (
          <Text dimColor>Zero model tampering</Text>
        )}
      </Box>
    </Box>
  );
}
