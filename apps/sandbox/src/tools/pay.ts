/**
 * PayBound Agent Sandbox — Payment Tool (Task 2.4)
 *
 * This is the SINGLE tool the agent in the adversarial sandbox domain is ever
 * allowed to call toward money (docs/ARCHITECTURE.md).
 *
 * INVARIANT: EXACTLY ONE PARAMETER (capabilityId).
 * There is no destination field, no amount field, and no resource field.
 * Free text and prompt injections have no parameters to populate.
 * "The agent can believe a malicious instruction. It still can't spend the money."
 *
 * Wire contract:
 * Reuses `payRequestSchema` from `@paybound/capability-spec` directly.
 * Calls Broker `POST /pay` endpoint (task 1.7, docs/PROTOCOL.md §1-§6).
 */

import { tool } from "ai";
import {
  payRequestSchema,
  payResponseSchema,
  type PayRequest,
  type PublicPaymentState,
  type AuthorizationFailureReason,
} from "@paybound/capability-spec";
import { config, brokerBaseUrl } from "../config.js";

/**
 * Result shape returned by the payment tool execution.
 * Differentiates successful submission from deliberate authorization rejection,
 * malformed inputs, unknown capabilities, and transport failures.
 */
export type PayToolResult =
  | {
      readonly success: true;
      readonly state: PublicPaymentState;
    }
  | {
      readonly success: false;
      readonly error: "payment_rejected";
      readonly message: string;
      readonly reason: AuthorizationFailureReason;
    }
  | {
      readonly success: false;
      readonly error: "capability_not_found";
      readonly capabilityId: string;
      readonly message: string;
    }
  | {
      readonly success: false;
      readonly error: "invalid_capability_id";
      readonly message: string;
    }
  | {
      readonly success: false;
      readonly error: "transport_error";
      readonly message: string;
    };

/**
 * ARCHITECTURAL DECISION (docs/PROTOCOL.md §4, Phase 2 Task 2.4):
 * Diagnostic signal vs. adversarial feedback posture:
 *
 * When the Broker rejects a payment (200 OK with { authorized: false, reason: "..." }),
 * what failure detail reaches the agent's LLM-visible tool result?
 *
 * Decision:
 * 1. Log the full detailed reason (`result.reason`, e.g. "REPLAY", "SUBSTITUTION",
 *    "BUDGET_EXCEEDED") to the sandbox console / audit logs for operational and
 *    audit visibility.
 * 2. Return a generic, sanitized failure indication to the LLM agent tool result:
 *    `message: "Payment authorization rejected by Broker"`.
 *
 * Rationale:
 * Handing an untrusted or prompt-injected LLM context fine-grained feedback
 * regarding which exact security clause triggered (e.g. learning that destination
 * was altered versus budget was exceeded) grants an adversary an oracle to probe
 * the Broker's authorization boundaries. The specific `reason` is included on the
 * programmatic result for audit and test assertions, but the visible `message`
 * remains generic.
 */
const GENERIC_REJECTION_MESSAGE = "Payment authorization rejected by Broker";

export interface PayToolOptions {
  readonly brokerUrl?: string;
  readonly fetch?: typeof fetch;
}

/**
 * Executes a payment call against the Broker's `POST /pay` endpoint.
 */
export async function executePay(
  request: PayRequest,
  options: PayToolOptions = {},
): Promise<PayToolResult> {
  // Structured, display-only event for apps/tui-dashboard — the exact instant the
  // agent invokes the pay tool, with the exact (and only) argument it can ever
  // carry. Pure logging: no effect on the request made below. See that package's
  // README for the NDJSON event contract this line is part of.
  console.log(
    `PB_TUI_EVENT ${JSON.stringify({ type: "pay_tool_call", capabilityId: request.capabilityId, timestamp: new Date().toISOString() })}`,
  );

  const fetchImpl = options.fetch ?? fetch;

  const targetUrl = options.brokerUrl ?? `${brokerBaseUrl(config)}/pay`;

  let response: Response;
  try {
    response = await fetchImpl(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ capabilityId: request.capabilityId }),
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: "transport_error",
      message: `Failed to connect to Broker pay endpoint: ${errorMsg}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: "transport_error",
      message: `Failed to parse Broker JSON response: ${errorMsg}`,
    };
  }

  // 1. 200 OK: Either authorized payment state or deliberate rejection (docs/PROTOCOL.md §3/§4)
  if (response.status === 200) {
    // Check if it is an authorization rejection: { authorized: false, reason: "..." }
    if (
      typeof body === "object" &&
      body !== null &&
      "authorized" in body &&
      (body as { authorized: unknown }).authorized === false
    ) {
      const rejectedBody = body as { authorized: false; reason: AuthorizationFailureReason };
      console.warn(
        `[AUDIT] Broker rejected payment for capability ${request.capabilityId}: reason=${rejectedBody.reason}`,
      );
      return {
        success: false,
        error: "payment_rejected",
        reason: rejectedBody.reason,
        message: GENERIC_REJECTION_MESSAGE,
      };
    }

    // Otherwise validate against payResponseSchema: { state: <PublicPaymentState> }
    const parsedSuccess = payResponseSchema.safeParse(body);
    if (parsedSuccess.success) {
      return {
        success: true,
        state: parsedSuccess.data.state,
      };
    }

    return {
      success: false,
      error: "transport_error",
      message: "Broker 200 response did not match expected PayResponse shape",
    };
  }

  // 2. 404 Not Found: Unknown capability (docs/PROTOCOL.md §6)
  if (response.status === 404) {
    const notFoundBody = body as { error?: string; capabilityId?: string };
    return {
      success: false,
      error: "capability_not_found",
      capabilityId: notFoundBody.capabilityId ?? request.capabilityId,
      message: "Capability not found in Broker records",
    };
  }

  // 3. 400 Bad Request: Malformed capabilityId (docs/PROTOCOL.md §6)
  if (response.status === 400) {
    const badRequestBody = body as { error?: string; message?: string };
    return {
      success: false,
      error: "invalid_capability_id",
      message: badRequestBody.message ?? "Invalid capability ID format",
    };
  }

  // 4. Other status codes
  return {
    success: false,
    error: "transport_error",
    message: `Unexpected HTTP status ${response.status} from Broker`,
  };
}

/**
 * Public interface for the agent payment tool, defining its description,
 * single-parameter input schema, and execution handler.
 */
export interface PayTool {
  readonly description: string;
  readonly inputSchema: typeof payRequestSchema;
  readonly execute: (input: PayRequest) => Promise<PayToolResult>;
}

/**
 * Creates an instance of the agent payment tool using Vercel AI SDK.
 * Exposes exactly one input parameter: `capabilityId`.
 */
export function createPayTool(options: PayToolOptions = {}): PayTool {
  return tool({
    description:
      "Execute a pre-authorized payment using an issued capability ID. " +
      "Takes exactly one parameter: capabilityId. " +
      "Destination address, amount, and resource are fixed at vetting time by the Broker " +
      "and cannot be specified here.",
    inputSchema: payRequestSchema,
    execute: async (input: PayRequest): Promise<PayToolResult> => {
      return executePay(input, options);
    },
  }) as unknown as PayTool;
}

/**
 * Default agent payment tool configured with the active sandbox environment configuration.
 */
export const payTool: PayTool = createPayTool();
