import type { PbEvent, StageId } from "./events.js";

export type StageStatus = "pending" | "active" | "done" | "failed";

export const STAGE_ORDER: readonly StageId[] = ["attest", "issue", "agent", "pay", "settle", "hcs"];

export const STAGE_LABELS: Record<StageId, string> = {
  attest: "Attest",
  issue: "Issue",
  agent: "Agent",
  pay: "Pay",
  settle: "Settle",
  hcs: "HCS",
};

export interface FinalResult {
  readonly paid: boolean;
  readonly provider?: string;
  readonly capabilityId?: string;
  readonly hederaTransactionId?: string;
  readonly status?: string;
  readonly hcsSequenceNumber?: number;
  readonly consensusTimestamp?: string;
  readonly hashscanUrl?: string;
}

export interface LogLine {
  readonly id: number;
  readonly text: string;
}

export type ProcessPhase = "waiting" | "running" | "succeeded" | "failed" | "exited";

export interface DashboardState {
  readonly phase: ProcessPhase;
  readonly stages: Readonly<Record<StageId, StageStatus>>;
  readonly capabilityId?: string;
  readonly lastToolCall?: { readonly capabilityId: string; readonly timestamp: string };
  readonly taskHash?: string;
  readonly contentUrl?: string;
  readonly scenario?: string;
  readonly paid?: boolean;
  readonly finalResult?: FinalResult;
  readonly errorMessage?: string;
  readonly log: readonly LogLine[];
}

const MAX_LOG_LINES = 10;
let logIdCounter = 0;

export function initialState(): DashboardState {
  const stages = {} as Record<StageId, StageStatus>;
  for (const s of STAGE_ORDER) stages[s] = "pending";
  return { phase: "waiting", stages, log: [] };
}

export function pushLog(state: DashboardState, text: string): DashboardState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const entry: LogLine = { id: ++logIdCounter, text: trimmed };
  return { ...state, log: [...state.log, entry].slice(-MAX_LOG_LINES) };
}

function setStage(state: DashboardState, stage: StageId, status: StageStatus): DashboardState {
  return { ...state, stages: { ...state.stages, [stage]: status } };
}

function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function stageLogText(stage: StageId, status: StageStatus): string {
  const label = STAGE_LABELS[stage];
  if (status === "active") return `${label}: in progress…`;
  if (status === "done") return `${label}: done`;
  if (status === "failed") return `${label}: failed`;
  return `${label}: ${status}`;
}

/**
 * Folds one parsed event into dashboard state. Pure and total over every
 * `PbEvent` variant — an event this dashboard doesn't recognize simply isn't
 * produced by `parseLine` (see events.ts), so there is no "unknown event"
 * branch to worry about crashing the render loop.
 */
export function reduceEvent(state: DashboardState, event: PbEvent): DashboardState {
  switch (event.type) {
    case "run_started":
      return pushLog({ ...state, phase: "running" }, "Run started.");

    case "task_seeded":
      return pushLog(
        { ...state, taskHash: event.taskHash },
        `Task seeded — hash ${short(event.taskHash)}, price ${event.price} HBAR`,
      );

    case "content_served": {
      const scenarioNote = event.scenarioLabel ? ` — scenario "${event.scenario}": ${event.scenarioLabel}` : "";
      const withContentUrl = { ...state, contentUrl: event.url };
      return pushLog(
        event.scenario ? { ...withContentUrl, scenario: event.scenario } : withContentUrl,
        `Untrusted content served at ${event.url}${scenarioNote}`,
      );
    }

    case "stage":
      return pushLog(setStage(state, event.stage, event.status), stageLogText(event.stage, event.status));

    case "capability_issued":
      return pushLog({ ...state, capabilityId: event.capabilityId }, `Capability issued: ${event.capabilityId}`);

    case "pay_tool_call": {
      const withCall = {
        ...state,
        lastToolCall: { capabilityId: event.capabilityId, timestamp: event.timestamp },
      };
      const advanced = setStage(setStage(withCall, "agent", "done"), "pay", "active");
      return pushLog(advanced, `pay(capabilityId: ${short(event.capabilityId)}) called`);
    }

    case "payment_result":
      return pushLog({ ...state, paid: event.paid }, `Payment result: paid=${event.paid} (served by ${event.servedBy})`);

    case "payment_outcome":
      return pushLog(
        setStage({ ...state, paid: event.paid }, "pay", event.paid ? "done" : "failed"),
        `Payment outcome — provider=${event.provider} paid=${event.paid}`,
      );

    case "settlement_found":
      return pushLog(
        state,
        `Settlement found on HCS: status=${event.status} tx=${event.hederaTransactionId} seq=${event.sequenceNumber}`,
      );

    case "mirror_confirmed":
      return pushLog(state, `Mirror node reconfirmed: outcome=${event.outcome} status=${event.status}`);

    case "final_result":
      return pushLog(
        { ...state, phase: "succeeded", finalResult: { ...event } },
        `FINAL: paid=${event.paid} tx=${event.hederaTransactionId} seq=${event.hcsSequenceNumber}`,
      );

    case "run_error":
      return pushLog(
        { ...state, phase: "failed", errorMessage: event.message },
        `ERROR (${event.source}): ${event.message}`,
      );
  }
}
