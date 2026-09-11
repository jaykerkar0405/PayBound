import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";

/** Panel 1 — "PayBound — Live Payment Trace". Purely decorative; reads no state. */
export function Banner(): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gradient name="cristal">
        <BigText text="PayBound" font="tiny" />
      </Gradient>
      <Text color="cyanBright" bold>
        Live Payment Trace
      </Text>
    </Box>
  );
}
