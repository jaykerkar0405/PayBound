import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { STAGE_ORDER, type DashboardState, type StageStatus } from "../state.js";
import type { StageId } from "../events.js";

const STAGE_SHORT_LABELS: Record<StageId, string> = {
  attest: "ATTEST",
  issue: "ISSUE",
  agent: "AGENT",
  pay: "PAY",
  settle: "SETTLE",
  hcs: "HCS",
  x402_purchase: "X402",
};

/**
 * Stage pipeline tracker — monochrome layout with green (success), red (failure),
 * and inverse black-on-white badge for active stage.
 */
export function StageTracker({ state }: { state: DashboardState }): React.JSX.Element {
  const completedCount = STAGE_ORDER.filter((s) => state.stages[s] === "done").length;
  const isFailed = STAGE_ORDER.some((s) => state.stages[s] === "failed");

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold>PIPELINE EXECUTION</Text>
        <Text dimColor>
          {isFailed ? (
            <Text color="red" bold>PIPELINE FAILED</Text>
          ) : completedCount === STAGE_ORDER.length ? (
            <Text color="green" bold>ALL STAGES COMPLETE</Text>
          ) : (
            `STAGE ${completedCount + 1} OF ${STAGE_ORDER.length}`
          )}
        </Text>
      </Box>

      <Box flexDirection="row" alignItems="center">
        {STAGE_ORDER.map((stage, i) => (
          <React.Fragment key={stage}>
            <StageBadge stage={stage} status={state.stages[stage]} />
            {i < STAGE_ORDER.length - 1 ? <Text dimColor>─</Text> : null}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

function StageBadge({ stage, status }: { stage: StageId; status: StageStatus }): React.JSX.Element {
  const label = STAGE_SHORT_LABELS[stage];
  if (status === "done") {
    return <Text color="green" bold>[✓ {label}]</Text>;
  }
  if (status === "active") {
    return (
      <Text inverse bold>
        {" "}<Spinner type="dots" /> {label}{" "}
      </Text>
    );
  }
  if (status === "failed") {
    return <Text color="red" bold>[✗ {label}]</Text>;
  }
  return <Text dimColor>[○ {label}]</Text>;
}
