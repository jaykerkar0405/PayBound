import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { issueRequestSchema } from "@paybound/capability-spec";
import { issueCapability } from "../issuer.js";

/**
 * POST /issue — HTTP endpoint for capability issuance.
 *
 * Accepts the five fields that `issueCapability()` requires
 * (`taskDefinition`, `resourceId`, `exactAmount`, `paymentRequest`,
 * `session`), validates them with `issueRequestSchema`, calls
 * `issueCapability()`, and returns `{ capabilityId, expiry }` on success.
 *
 * Error handling mirrors pay.ts:
 *  - 400 on schema validation failure (zValidator callback)
 *  - 404 when `resourceId` is not in the registry
 *  - 422 when `exactAmount` doesn't match the registry price
 *
 * Explicit non-goals: this route does not call `createTask()` (budget.ts),
 * add authentication, or make the issued capability immediately payable
 * end-to-end — that wiring belongs to task 6.1.
 */
export const issueRoute = new Hono();

issueRoute.post(
  "/",
  zValidator("json", issueRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_request", message: result.error.message }, 400);
    }
  }),
  (c) => {
    const { taskDefinition, resourceId, exactAmount, paymentRequest, session } =
      c.req.valid("json");

    try {
      const result = issueCapability({
        taskDefinition,
        resourceId,
        exactAmount,
        paymentRequest,
        session,
      });

      return c.json({ capabilityId: result.capabilityId, expiry: result.expiry }, 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      // issuer.ts throws two known cases — match on the prefix to distinguish them
      if (message.includes("is not a known resource registry entry")) {
        return c.json({ error: "unknown_resource", message }, 404);
      }

      if (message.includes("does not match registry price")) {
        return c.json({ error: "price_mismatch", message }, 422);
      }

      // Unexpected error — re-throw so Hono's default handler returns 500
      throw err;
    }
  },
);
