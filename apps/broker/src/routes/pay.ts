import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  payRequestSchema,
  issuedPaymentStateSchema,
  reservedPaymentStateSchema,
  type PaymentAuthorizationRequest,
  type IssuedPaymentState,
  type ReservedPaymentState,
} from "@paybound/capability-spec";
import { getCapabilityRecord } from "../issuer.js";
import { getTask } from "../budget.js";
import { authorize } from "../authorize.js";
import { submitPayment } from "../state-machine.js";
import { stubSign } from "../signer.js";

/**
 * POST /pay — the single wire call the agent sandbox is allowed to make
 * toward money (docs/PROTOCOL.md). Accepts only { capabilityId } — never
 * nonce, amount, destination, or any other capability field from the
 * request body. Every field authorize() needs is reconstructed server-side
 * from getCapabilityRecord(capabilityId), the Broker's own database read —
 * never from request-body data.
 */
/**
 * FINDING (flagged, not silently patched): docs/PROTOCOL.md §3 says a
 * successful response nests the full ISSUED -> RESERVED -> SUBMITTED
 * history, and Capability (packages/types) requires `nonce` as a mandatory
 * field — so the currently-typed PayResponse/SubmittedPaymentState shape
 * structurally includes the nonce on the wire. That's in direct tension
 * with docs/OPEN_QUESTIONS.md "Resolved: capability_id vs. nonce": "The
 * nonce stays internal to the Broker's replay-defense mechanism; the
 * sandbox never sees or handles it." This redacts `nonce` from the
 * outgoing JSON at this HTTP boundary — the one place trusted internal
 * data departs the Broker toward the untrusted sandbox — so the wire
 * response never carries it. This means the emitted JSON no longer
 * strictly conforms to payResponseSchema's current shape (nonce required);
 * that schema/PROTOCOL.md gap should be tracked as a follow-up rather than
 * assumed resolved by this redaction alone.
 */
function redactNonce<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactNonce(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "nonce");
    return Object.fromEntries(entries.map(([key, v]) => [key, redactNonce(v)])) as T;
  }
  return value;
}

export const payRoute = new Hono();

payRoute.post(
  "/",
  zValidator("json", payRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_capability_id", message: result.error.message }, 400);
    }
  }),
  (c) => {
    const { capabilityId } = c.req.valid("json");

    const record = getCapabilityRecord(capabilityId);
    if (record === undefined) {
      return c.json({ error: "capability_not_found", capabilityId }, 404);
    }

    const task = getTask(record.capability.taskHash);
    if (task === undefined) {
      throw new Error(
        `pay: no task budget record for taskHash "${record.capability.taskHash}" (capability issued without a corresponding task)`,
      );
    }

    const payment: PaymentAuthorizationRequest = {
      amount: record.capability.exactAmount,
      destination: record.capability.recipient,
      resource: record.capability.resourceId,
      taskHash: record.capability.taskHash,
      session: record.capability.session,
      paymentRequestHash: record.capability.paymentRequestHash,
    };

    const result = authorize({ payment, capability: record.capability, task });

    if (!result.authorized) {
      return c.json({ authorized: false, reason: result.reason }, 200);
    }

    // authorize() already performed the RESERVED transition (burned the
    // nonce, reserved the budget) as a side effect of its internal
    // reservePayment call, but AuthorizationResult (packages/types) has no
    // field to carry that ReservedPaymentState out — reconstruct the same
    // value here, from the same (now-reserved) capability, to hand to
    // submitPayment. This call is synchronous through SUBMITTED only —
    // settlement (resolveSubmission) is deliberately not called here
    // (docs/PROTOCOL.md §1).
    const issuedFrom: IssuedPaymentState = issuedPaymentStateSchema.parse({
      status: "ISSUED",
      capability: record.capability,
    });
    const reserved: ReservedPaymentState = reservedPaymentStateSchema.parse({
      status: "RESERVED",
      capability: record.capability,
      issuedFrom,
    });

    const submitted = submitPayment(reserved, stubSign);

    return c.json({ state: redactNonce(submitted) }, 200);
  },
);
