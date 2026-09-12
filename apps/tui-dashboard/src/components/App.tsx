import React, { useEffect, useReducer } from "react";
import { Box, Text } from "ink";
import { Banner } from "./Banner.js";
import { StageTracker } from "./StageTracker.js";
import { ToolCallPanel } from "./ToolCallPanel.js";
import { ResultPanel } from "./ResultPanel.js";
import { TxnLog } from "./TxnLog.js";
import { EventLog } from "./EventLog.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { initialState, pushLog, reduceEvent, type DashboardState } from "../state.js";
import { parseLine } from "../events.js";
import { startE2ELiveRun, startReplay } from "../runner.js";

type Action =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "spawn_error"; readonly message: string }
  | { readonly kind: "process_exit"; readonly code: number | null };

function cleanRawLine(line: string): string {
  const stripped = line
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^\s*\[sandbox\]\s*/, "")
    .trim();
  if (!stripped) return "";
  if (stripped.includes("PB_TUI_EVENT")) return ""; // shown via its structured event instead
  if (/^[{}[\],]*$/.test(stripped)) return ""; // fragment of a pretty-printed JSON block
  if (/^"[a-zA-Z]+":/.test(stripped)) return ""; // ditto
  if (/^(toolCalls|readResults|payResults):\s*\[/.test(stripped)) return "";
  if (/^Estimated cost:/.test(stripped)) return "";
  if (/^===/.test(stripped)) return "";
  return stripped;
}

function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.kind) {
    case "spawn_error":
      return {
        ...pushLog(state, `Could not start e2e:live: ${action.message}`),
        phase: "failed",
        errorMessage: action.message,
      };
    case "process_exit":
      if (state.phase === "running" || state.phase === "waiting") {
        return pushLog({ ...state, phase: "exited" }, `e2e:live process exited (code ${action.code ?? "null"}).`);
      }
      return state;
    case "line": {
      const withRunning: DashboardState = state.phase === "waiting" ? { ...state, phase: "running" } : state;
      const event = parseLine(action.text);
      if (event) return reduceEvent(withRunning, event);
      return pushLog(withRunning, cleanRawLine(action.text));
    }
  }
}

export interface AppProps {
  readonly replayFile?: string | undefined;
}

const MIN_WIDTH = 80;

function getTerminalDimensions(): { width: number; rows: number } {
  const envCols = process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : undefined;
  const envRows = process.env.LINES ? parseInt(process.env.LINES, 10) : undefined;
  const columns = envCols || process.stdout.columns || 100;
  const rows = envRows || process.stdout.rows || 28;
  return {
    width: Math.max(MIN_WIDTH, columns),
    rows: Math.max(24, rows),
  };
}

/**
 * Main Layout:
 * 1. Banner (3 rows)
 * 2. StageTracker (4 rows)
 * 3. Two-Column Midsection (ToolCallPanel + ResultPanel, 7 rows)
 * 4. TxnLog (Transaction registry with full HashScan URLs, 4 rows)
 * 5. EventLog (Wrapped, non-stripped audit stream dynamically sized to fit terminal rows)
 * 6. Footer (1 row)
 */
export function App({ replayFile }: AppProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const { width, rows } = getTerminalDimensions();

  const colGap = 1;
  const colLeft = Math.floor((width - colGap) / 2);
  const colRight = width - colGap - colLeft;

  // Fixed overhead: Banner (3) + Pipeline (4) + Columns (7) + TxnLog (4) + Footer (1) + EventLog chrome (2) = 21 rows.
  // Remaining rows are allocated directly to log entries so total height <= rows.
  const availableForLogs = Math.max(4, Math.min(16, rows - 22));

  useEffect(() => {
    const callbacks = {
      onLine: (text: string) => dispatch({ kind: "line", text }),
      onExit: (code: number | null) => dispatch({ kind: "process_exit", code }),
      onSpawnError: (message: string) => dispatch({ kind: "spawn_error", message }),
    };
    const handle = replayFile ? startReplay(replayFile, callbacks) : startE2ELiveRun(callbacks);
    return () => handle.stopTailing();
  }, [replayFile]);

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width={width}>
        <Banner />
        <StageTracker state={state} />
        <Box flexDirection="row" width={width} gap={colGap}>
          <ToolCallPanel state={state} width={colLeft} />
          <ResultPanel state={state} width={colRight} />
        </Box>
        <TxnLog state={state} />
        <EventLog state={state} maxLines={availableForLogs} />
        <Box justifyContent="space-between" paddingX={1}>
          <Text dimColor>[Ctrl+C] Detach TUI (Execution continues detached)</Text>
          <Text dimColor>TERMINAL: {width}x{rows}</Text>
        </Box>
      </Box>
    </ErrorBoundary>
  );
}
