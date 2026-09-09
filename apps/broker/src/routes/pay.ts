import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  payRequestSchema,
  publicSubmittedPaymentStateSchema,
  type PaymentAuthorizationRequest,
} from "@paybound/capability-spec";
import { getCapabilityRecord } from "../issuer.js";
import { getTask } from "../budget.js";
import { authorize } from "../authorize.js";
import { submitPayment } from "../state-machine.js";
import { resolveSigner } from "../signer.js";

/**
 * POST /pay — the single wire call the agent sandbox is allowed to make
 * toward money (docs/PROTOCOL.md). Accepts only { capabilityId } — never
 * nonce, amount, destination, or any other capability field from the
 * request body. Every field authorize() needs is reconstructed server-side
 * from getCapabilityRecord(capabilityId), the Broker's own database read —
 * never from request-body data.
 *
 * The success response is built via publicSubmittedPaymentStateSchema
 * (packages/types), whose nested Capability has no `nonce` field at all —
 * the nonce omission is enforced by the type system (there is nothing to
 * accidentally serialize), not a runtime strip step. Passing the real,
 * nonce-carrying SubmittedPaymentState through this schema's `.parse()`
 * validates the response shape and drops the nonce, since Zod's default
 * object parsing discards keys that aren't part of the target shape.
 */
export const payRoute = new Hono();

payRoute.post(
  "/",
  zValidator("json", payRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_capability_id", message: result.error.message }, 400);
    }
  }),
  async (c) => {
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

    // result.state is the real ReservedPaymentState authorize() produced
    // as part of the RESERVED transition — used directly, not
    // reconstructed. This awaits through SUBMITTED only: settlement
    // (resolveSubmission) is deliberately not called here
    // (docs/PROTOCOL.md §1). Awaiting here (rather than blocking) is what
    // keeps a slow/pending Ledger signature from stalling other in-flight
    // requests — see signer.ts's `ledgerSign`.
    try {
      const submitted = await submitPayment(result.state, resolveSigner());
      return c.json({ state: publicSubmittedPaymentStateSchema.parse(submitted) }, 200);
    } catch (err) {
      // The RESERVED transition above already burned the nonce and
      // reserved budget; a signer failure here (e.g. an unreachable
      // Ledger/Speculos device, an on-device rejection, or a timeout)
      // leaves the payment stuck at RESERVED rather than resolving to
      // SUBMITTED. Reconciling that into a FAILED/RECOVERABLE transition
      // is tracked separately (docs/TASKS.md 4.3) — this only ensures the
      // caller gets a structured error instead of Hono's default
      // plain-text 500, which the sandbox's payTool can't parse as JSON.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AUDIT] pay: signer failed for capability ${capabilityId}: ${message}`);
      return c.json({ error: "signer_failed", message }, 502);
    }
  },
);
