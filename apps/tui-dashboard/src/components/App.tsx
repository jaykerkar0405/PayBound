import React, { useEffect, useReducer } from "react";
import { Box, Text } from "ink";
import { Banner } from "./Banner.js";
import { StageTracker } from "./StageTracker.js";
import { ToolCallPanel } from "./ToolCallPanel.js";
import { EventLog } from "./EventLog.js";
import { ResultPanel } from "./ResultPanel.js";
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
  return stripped.length > 96 ? `${stripped.slice(0, 93)}...` : stripped;
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
const MAX_WIDTH = 100;

/** Clamped to the documented 80-100 column assumption (README.md) — fits the actual terminal within that range instead of always assuming 100. */
function layoutWidth(): number {
  const columns = process.stdout.columns || MAX_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, columns));
}

/** Panel layout, top to bottom: Banner, StageTracker, ToolCallPanel, EventLog, ResultPanel. */
export function App({ replayFile }: AppProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const width = layoutWidth();

  useEffect(() => {
    const callbacks = {
      onLine: (text: string) => dispatch({ kind: "line", text }),
      onExit: (code: number | null) => dispatch({ kind: "process_exit", code }),
      onSpawnError: (message: string) => dispatch({ kind: "spawn_error", message }),
    };
    const handle = replayFile ? startReplay(replayFile, callbacks) : startE2ELiveRun(callbacks);
    // Only stops *this dashboard's* tailing loop — never touches the child
    // process itself. See runner.ts's top doc comment.
    return () => handle.stopTailing();
  }, [replayFile]);

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width={width}>
        <Banner />
        <StageTracker state={state} />
        <ToolCallPanel state={state} />
        <EventLog state={state} />
        {state.phase === "waiting" ? (
          <Text dimColor>Waiting for the e2e:live process to start…</Text>
        ) : null}
        <ResultPanel state={state} />
      </Box>
    </ErrorBoundary>
  );
}
