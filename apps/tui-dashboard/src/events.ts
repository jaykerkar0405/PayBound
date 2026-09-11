/**
 * PayBound TUI Dashboard — event contract (Task 6.x)
 *
 * These are the structured, single-line NDJSON events the dashboard reads.
 * They are emitted by three real, otherwise-unmodified scripts/files as pure,
 * additive `console.log` lines alongside their existing human-readable
 * output — never a replacement for it:
 *
 *   - apps/broker/scripts/e2e-live-demo.ts  (the process this app spawns)
 *   - apps/sandbox/src/live-run.ts          (spawned BY e2e-live-demo.ts;
 *     its stdout/stderr is already forwarded, line-prefixed with
 *     "  [sandbox] ", through e2e-live-demo.ts's own stdout — see that
 *     file's `runAgent()`)
 *   - apps/sandbox/src/tools/pay.ts         (the single money-moving tool;
 *     logs the instant it is invoked, before it does anything else)
 *
 * Every line is `PB_TUI_EVENT <json>` — one line, compact JSON, no embedded
 * newlines, findable via `indexOf` regardless of what prefix (like
 * "  [sandbox] ") ends up in front of it after being forwarded through a
 * parent process's own stdout.
 *
 * This dashboard treats these events as trusted, display-only data: it never
 * writes anything back to the process it reads from, so nothing here can
 * feed back into the payment flow.
 */

export type StageId = "attest" | "issue" | "agent" | "pay" | "settle" | "hcs";
export type StageEventStatus = "active" | "done" | "failed";

export type PbEvent =
  | { type: "run_started" }
  | { type: "task_seeded"; taskHash: string; price: string }
  | { type: "content_served"; url: string }
  | { type: "stage"; stage: StageId; status: StageEventStatus }
  | { type: "capability_issued"; capabilityId: string }
  | { type: "pay_tool_call"; capabilityId: string; timestamp: string }
  | { type: "payment_result"; paid: boolean; servedBy: string }
  | { type: "payment_outcome"; provider: string; capabilityId?: string; paid: boolean }
  | {
      type: "settlement_found";
      status: string;
      hederaTransactionId: string;
      consensusTimestamp: string;
      sequenceNumber: number;
    }
  | { type: "mirror_confirmed"; outcome: string; status: string; hashscanUrl: string }
  | {
      type: "final_result";
      paid: boolean;
      provider?: string;
      capabilityId?: string;
      hederaTransactionId: string;
      status: string;
      hcsSequenceNumber: number;
      consensusTimestamp: string;
      hashscanUrl?: string;
    }
  | { type: "run_error"; source: string; stage?: string; message: string };

const EVENT_MARKER = "PB_TUI_EVENT";

const KNOWN_TYPES: ReadonlySet<PbEvent["type"]> = new Set([
  "run_started",
  "task_seeded",
  "content_served",
  "stage",
  "capability_issued",
  "pay_tool_call",
  "payment_result",
  "payment_outcome",
  "settlement_found",
  "mirror_confirmed",
  "final_result",
  "run_error",
]);

/**
 * Extracts a `PbEvent` from one raw stdout/stderr line, if it is one.
 * Tolerant by design: this reads output from our own trusted instrumentation
 * (not attacker-controlled input), so a malformed or unrecognized line is
 * simply not an event — it falls through to the raw-text log instead of
 * throwing.
 */
export function parseLine(line: string): PbEvent | undefined {
  const idx = line.indexOf(EVENT_MARKER);
  if (idx === -1) return undefined;

  const jsonText = line.slice(idx + EVENT_MARKER.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "type" in parsed &&
    typeof (parsed as { type: unknown }).type === "string" &&
    KNOWN_TYPES.has((parsed as { type: PbEvent["type"] }).type)
  ) {
    return parsed as PbEvent;
  }
  return undefined;
}
