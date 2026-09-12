import React from "react";
import { Box, Text } from "ink";
import type { DashboardState, LogLine } from "../state.js";

function getLogColor(text: string): "red" | "green" | undefined {
  if (text.includes("ERROR") || text.includes("failed") || text.includes("✗")) {
    return "red";
  }
  if (
    text.includes("FINAL") ||
    text.includes("SUCCESS") ||
    text.includes("✓") ||
    text.includes("paid=true") ||
    text.includes("Settlement found")
  ) {
    return "green";
  }
  return undefined;
}

/**
 * Event Stream Panel — Displays real-time [AUDIT], stage, and settlement events.
 * Formats each entry with zero-padded line numbers and HH:MM:SS timestamps.
 * Uses wrap="wrap" to guarantee zero line stripping or truncation.
 */
export function EventLog({
  state,
  maxLines = 8,
}: {
  state: DashboardState;
  maxLines?: number;
}): React.JSX.Element {
  const visibleLogs = state.log.slice(-maxLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold>AUDIT & TELEMETRY STREAM</Text>
        <Text dimColor>{state.log.length} TOTAL EVENTS</Text>
      </Box>

      {visibleLogs.length === 0 ? (
        <Text dimColor>(waiting for telemetry stream…)</Text>
      ) : (
        visibleLogs.map((line: LogLine) => {
          const color = getLogColor(line.text);
          return (
            <Box key={line.id} flexDirection="row">
              <Box flexShrink={0}>
                <Text dimColor>
                  {String(line.id).padStart(2, "0")} │ {line.time} │{" "}
                </Text>
              </Box>
              <Box flexGrow={1}>
                {color ? (
                  <Text color={color} wrap="wrap">
                    {line.text}
                  </Text>
                ) : (
                  <Text wrap="wrap">{line.text}</Text>
                )}
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
