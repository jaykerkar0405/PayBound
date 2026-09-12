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

  const isPayFailed = state.stages.pay === "failed";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isPayFailed ? "red" : "gray"}
      paddingX={1}
      width={width}
    >
      <Box justifyContent="space-between">
        <Text bold>AGENT TOOL DISPATCH</Text>
        {call ? (
          <Text color={isPayFailed ? "red" : "green"} bold>{isPayFailed ? "[REJECTED]" : "[DISPATCHED]"}</Text>
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
        {isPayFailed ? (
          <Text color="red" bold>Invariant: Unissued capability rejected</Text>
        ) : (
          <Text dimColor>Zero model tampering</Text>
        )}
      </Box>
    </Box>
  );
}
