import React from "react";
import { Box, Text } from "ink";
import type { DashboardState } from "../state.js";

/**
 * Panel 3 — the single most important visual moment: the exact instant the
 * agent invokes `pay(capabilityId)`, showing the real, exact JSON payload it
 * sent (see apps/sandbox/src/tools/pay.ts's `pay_tool_call` event — emitted
 * before the request is made, from the one and only tool the agent can ever
 * call toward money). There is no amount field and no recipient field for a
 * prompt injection to have populated, because the tool itself has none.
 */
export function ToolCallPanel({ state }: { state: DashboardState }): React.JSX.Element {
  const call = state.lastToolCall;
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={call ? "magenta" : "gray"}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="magenta">
        pay() tool call
      </Text>
      {call ? (
        <>
          <Text>{JSON.stringify({ capabilityId: call.capabilityId }, null, 2)}</Text>
          <Text dimColor italic>
            no amount, no recipient — nothing to corrupt
          </Text>
        </>
      ) : (
        <Text dimColor>waiting for the agent to call pay()…</Text>
      )}
    </Box>
  );
}
