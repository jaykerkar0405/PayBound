/**
 * Ported verbatim from apps/tui-dashboard/src/state.ts (kept in sync by
 * hand — this logic has zero Ink/terminal dependencies, so the web demo
 * reuses the exact same reducer instead of re-deriving it). See that
 * file for the canonical version and its own history/tests.
 */
import type { PbEvent, StageId } from "./events.js";

export type StageStatus = "pending" | "active" | "done" | "failed";

export const STAGE_ORDER: readonly StageId[] = ["attest", "issue", "agent", "pay", "settle", "hcs", "x402_purchase"];

export const STAGE_LABELS: Record<StageId, string> = {
  attest: "Attest",
  issue: "Issue",
  agent: "Agent",
  pay: "Pay",
  settle: "Settle",
  hcs: "HCS",
  x402_purchase: "X402",
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

/**
 * The independent outcome of one of the two stages `scripts/e2e-live-demo.ts`
 * runs — the security-relevant adversarial agent scenario ("scenario"), and
 * the separate, credentials-based x402 gated-content purchase ("x402"),
 * which `main()` in that script always runs *after* the scenario stage
 * regardless of whether the scenario itself succeeded or failed.
 *
 * Tracked independently (rather than folded into one overwritable
 * `finalResult`) so that a real failure in one stage can never be visually
 * masked by a later, unrelated success in the other — see
 * `deriveOverallOutcome`'s doc comment below for the actual fix.
 */
export interface TrackOutcome {
  readonly status: "succeeded" | "failed";
  readonly result?: FinalResult;
  readonly errorMessage?: string;
}

export interface LogLine {
  readonly id: number;
  readonly text: string;
  readonly time: string;
}

export type ProcessPhase = "waiting" | "running" | "succeeded" | "failed" | "exited";

export interface TxLogEntry {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly sequenceNumber?: number;
  readonly url: string;
}

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
  /** Independent outcome of the security-relevant agent scenario stage — see `TrackOutcome`. */
  readonly scenarioOutcome?: TrackOutcome;
  /** Independent outcome of the separate x402 gated-content purchase stage — see `TrackOutcome`. */
  readonly x402Outcome?: TrackOutcome;
  readonly txns: readonly TxLogEntry[];
}

const MAX_LOG_LINES = 10;
let logIdCounter = 0;

export function initialState(): DashboardState {
  const stages = {} as Record<StageId, StageStatus>;
  for (const s of STAGE_ORDER) stages[s] = "pending";
  return { phase: "waiting", stages, log: [], txns: [] };
}

export function pushLog(state: DashboardState, text: string, time?: string): DashboardState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const now = time ?? new Date().toTimeString().slice(0, 8);
  const entry: LogLine = { id: ++logIdCounter, text: trimmed, time: now };
  return { ...state, log: [...state.log, entry].slice(-MAX_LOG_LINES) };
}

function setStage(state: DashboardState, stage: StageId, status: StageStatus): DashboardState {
  return { ...state, stages: { ...state.stages, [stage]: status } };
}

function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Combines the two independent track outcomes into one overall
 * phase/result — the actual fix for the audit's finding that the Result
 * panel was overwritten by whichever of the two stages finished last.
 *
 * Failure is checked FIRST and unconditionally, regardless of which track
 * failed or what the other track's status is: if either has failed, the
 * overall run is "failed", full stop. Since `scripts/e2e-live-demo.ts`
 * always runs the x402 stage after the scenario stage regardless of the
 * scenario's own outcome, without this a scenario failure could be
 * (and, per the audit, was) visually overwritten by the x402 leg
 * succeeding moments later. This function is pure and re-derives the
 * overall outcome from both track states on every call, so the order
 * events actually arrive in cannot matter — the property this needs is
 * exactly that ordering-independence, not "process failures before
 * successes."
 *
 * Once either track has failed, no combination of the other track's status
 * changes the derived phase back to "succeeded" — a previously-failed
 * track's outcome is carried forward unchanged by every caller (see
 * `applyTrackOutcome`), so "failed" is effectively sticky for the
 * remainder of the run.
 */
type OverallOutcome =
  | { readonly phase: "running" }
  | { readonly phase: "failed"; readonly errorMessage?: string }
  | { readonly phase: "succeeded"; readonly result?: FinalResult };

function deriveOverallOutcome(
  scenarioOutcome: TrackOutcome | undefined,
  x402Outcome: TrackOutcome | undefined,
): OverallOutcome {
  if (scenarioOutcome?.status === "failed") {
    return scenarioOutcome.errorMessage !== undefined
      ? { phase: "failed", errorMessage: scenarioOutcome.errorMessage }
      : { phase: "failed" };
  }
  if (x402Outcome?.status === "failed") {
    return x402Outcome.errorMessage !== undefined
      ? { phase: "failed", errorMessage: x402Outcome.errorMessage }
      : { phase: "failed" };
  }
  // Neither has failed. The x402 leg's result is the more "final" one to
  // show once present (it always runs last in the real script) — prefer
  // it over the scenario's own result when both have succeeded.
  if (x402Outcome?.status === "succeeded") {
    return x402Outcome.result !== undefined ? { phase: "succeeded", result: x402Outcome.result } : { phase: "succeeded" };
  }
  if (scenarioOutcome?.status === "succeeded") {
    return scenarioOutcome.result !== undefined
      ? { phase: "succeeded", result: scenarioOutcome.result }
      : { phase: "succeeded" };
  }
  return { phase: "running" };
}

/** Records one track's outcome and recomputes the overall phase/result/errorMessage from both tracks — see `deriveOverallOutcome`. */
function applyTrackOutcome(
  state: DashboardState,
  track: "scenario" | "x402",
  outcome: TrackOutcome,
): DashboardState {
  const scenarioOutcome = track === "scenario" ? outcome : state.scenarioOutcome;
  const x402Outcome = track === "x402" ? outcome : state.x402Outcome;

  // exactOptionalPropertyTypes forbids assigning a possibly-undefined value
  // to an optional key — build the object with each optional key added
  // only when actually defined, same pattern the rest of this file already
  // uses (e.g. the content_served case above).
  const withScenario = scenarioOutcome !== undefined ? { ...state, scenarioOutcome } : state;
  const withOutcomes = x402Outcome !== undefined ? { ...withScenario, x402Outcome } : withScenario;

  const derived = deriveOverallOutcome(scenarioOutcome, x402Outcome);

  if (derived.phase === "running") {
    return withOutcomes;
  }
  if (derived.phase === "failed") {
    // Omitting finalResult entirely (rather than setting it to undefined)
    // lets ResultPanel fall through to its "failed" branch instead of
    // rendering a stale success — matching the original
    // run_error-overrides-success behavior, now derived from both tracks
    // instead of a single last-write-wins field.
    const { finalResult: _droppedFinalResult, ...rest } = withOutcomes;
    return derived.errorMessage !== undefined
      ? { ...rest, phase: "failed", errorMessage: derived.errorMessage }
      : { ...rest, phase: "failed" };
  }
  return derived.result !== undefined
    ? { ...withOutcomes, phase: "succeeded", finalResult: derived.result }
    : { ...withOutcomes, phase: "succeeded" };
}

function stageLogText(stage: StageId, status: StageStatus): string {
  const label = STAGE_LABELS[stage];
  if (status === "active") return `${label}: in progress…`;
  if (status === "done") return `${label}: done`;
  if (status === "failed") return `${label}: failed`;
  return `${label}: ${status}`;
}

function addTxn(state: DashboardState, txn: TxLogEntry): DashboardState {
  const current = state.txns ?? [];
  const existingIdx = current.findIndex((t) => t.id === txn.id);
  if (existingIdx !== -1) {
    const updated = [...current];
    const prev = updated[existingIdx];
    if (prev) updated[existingIdx] = { ...prev, ...txn };
    return { ...state, txns: updated };
  }
  return { ...state, txns: [...current, txn] };
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

    case "settlement_found": {
      const url = `https://hashscan.io/testnet/transaction/${event.hederaTransactionId}`;
      const withTx = addTxn(state, {
        id: event.hederaTransactionId,
        label: "Scenario Settlement",
        status: event.status,
        sequenceNumber: event.sequenceNumber,
        url,
      });
      return pushLog(
        withTx,
        `Settlement found on HCS: status=${event.status} tx=${event.hederaTransactionId} seq=${event.sequenceNumber}`,
      );
    }

    case "mirror_confirmed": {
      const current = state.txns ?? [];
      const updated = current.map((t) =>
        event.hashscanUrl.includes(t.id) ? { ...t, url: event.hashscanUrl, status: event.status } : t,
      );
      return pushLog({ ...state, txns: updated }, `Mirror node reconfirmed: outcome=${event.outcome} status=${event.status}`);
    }

    case "final_result": {
      const url = event.hashscanUrl ?? `https://hashscan.io/testnet/transaction/${event.hederaTransactionId}`;
      const withTx = addTxn(state, {
        id: event.hederaTransactionId,
        label: "Scenario Settlement",
        status: event.status,
        sequenceNumber: event.hcsSequenceNumber,
        url,
      });
      return pushLog(
        applyTrackOutcome(withTx, "scenario", { status: "succeeded", result: { ...event } }),
        `FINAL: paid=${event.paid} tx=${event.hederaTransactionId} seq=${event.hcsSequenceNumber}`,
      );
    }

    case "run_error": {
      // Routes to whichever of the two independent stages this error
      // actually belongs to — e2e-live-demo.ts tags the x402 leg's own
      // failures with stage: "x402_purchase"; every other stage value
      // (including "agent"/"pay"/"settle" and the top-level "unknown"
      // catch-all) belongs to the security-relevant scenario stage. See
      // applyTrackOutcome/deriveOverallOutcome for why this can no longer
      // be masked by a later, unrelated success on the other track.
      const track = event.stage === "x402_purchase" ? "x402" : "scenario";
      return pushLog(
        applyTrackOutcome(state, track, { status: "failed", errorMessage: event.message }),
        `ERROR (${event.source}): ${event.message}`,
      );
    }

    case "x402_purchase_result": {
      const result: FinalResult = {
        paid: event.success,
        provider: "x402",
        hederaTransactionId: event.hederaTransactionId,
        status: event.status,
        hashscanUrl: event.hashscanUrl,
      };
      const outcome: TrackOutcome = event.success
        ? { status: "succeeded", result }
        : { status: "failed", result, errorMessage: `x402 purchase failed (status ${event.status})` };
      const url = event.hashscanUrl || `https://hashscan.io/testnet/transaction/${event.hederaTransactionId}`;
      const withTx = addTxn(state, {
        id: event.hederaTransactionId,
        label: "x402 Gated Purchase",
        status: event.status,
        url,
      });
      return pushLog(
        applyTrackOutcome(withTx, "x402", outcome),
        `X402 PURCHASE: paid=${event.success} tx=${event.hederaTransactionId} status=${event.status}`,
      );
    }
  }
}
