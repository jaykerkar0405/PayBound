import React from "react";
import { Box, Text } from "ink";

interface ErrorBoundaryState {
  readonly error?: Error;
}

/**
 * A render error here is a display bug, not a payment-flow failure — the
 * `e2e:live` process this dashboard tails (see runner.ts) is a fully
 * independent process and keeps running/settling regardless of what this
 * component does. This boundary exists so a bad event/render doesn't take
 * down the whole terminal UI mid-recording; it swaps in a small error panel
 * instead of unmounting everything.
 */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error("[tui-dashboard] render error (display-only — underlying run is unaffected):", error.stack ?? error.message);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <Box borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red">Dashboard render error: {this.state.error.message}</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
