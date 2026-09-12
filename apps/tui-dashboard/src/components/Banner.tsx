import React from "react";
import { Box, Text } from "ink";

/**
 * Top command header — compact monochrome banner.
 * Exactly 3 lines high to ensure the dashboard fits inside standard terminal rows.
 */
export function Banner(): React.JSX.Element {
  return (
    <Box
      justifyContent="space-between"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box gap={1}>
        <Text inverse bold>
          {" "}PAYBOUND{" "}
        </Text>
        <Text bold>AGENT RUNTIME</Text>
      </Box>
      <Text dimColor>HEDERA TESTNET │ HSM: ACTIVE</Text>
    </Box>
  );
}
