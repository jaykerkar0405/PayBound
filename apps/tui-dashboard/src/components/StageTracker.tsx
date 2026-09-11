import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { STAGE_ORDER, STAGE_LABELS, type DashboardState, type StageStatus } from "../state.js";
import type { StageId } from "../events.js";

/** Panel 2 — the 6 real e2e:live stages (Attest, Issue, Agent, Pay, Settle, HCS). */
export function StageTracker({ state }: { state: DashboardState }): React.JSX.Element {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
      {STAGE_ORDER.map((stage, i) => (
        <Box key={stage}>
          <StageBadge stage={stage} status={state.stages[stage]} />
          {i < STAGE_ORDER.length - 1 ? <Text color="gray"> {"->"} </Text> : null}
        </Box>
      ))}
    </Box>
  );
}

function StageBadge({ stage, status }: { stage: StageId; status: StageStatus }): React.JSX.Element {
  const label = STAGE_LABELS[stage];
  if (status === "done") {
    return <Text color="green">✓ {label}</Text>;
  }
  if (status === "active") {
    return (
      <Text color="yellow" bold>
        <Spinner type="dots" /> {label}
      </Text>
    );
  }
  if (status === "failed") {
    return <Text color="red">✗ {label}</Text>;
  }
  return <Text dimColor>{label}</Text>;
}
