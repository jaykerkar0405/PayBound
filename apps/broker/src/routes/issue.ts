import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { issueRequestSchema } from "@paybound/capability-spec";
import { issueCapability, getCapabilityRecord } from "../issuer.js";
import { checkSpendPolicy } from "../cre-policy.js";
import { createTask, getTask } from "../budget.js";
import { getResourceById } from "../registry.js";

/**
 * POST /issue — HTTP endpoint for capability issuance.
 *
 * Accepts the five fields that `issueCapability()` requires
 * (`taskDefinition`, `resourceId`, `exactAmount`, `paymentRequest`,
 * `session`), validates them with `issueRequestSchema`, calls
 * `issueCapability()`, synchronously creates the task's budget record
 * (task 6.x — see below), and returns `{ capabilityId, expiry }` on
 * success.
 *
 * Error handling mirrors pay.ts:
 *  - 400 on schema validation failure (zValidator callback)
 *  - 404 when `resourceId` is not in the registry
 *  - 422 when `exactAmount` doesn't match the registry price
 *
 * Task budget creation (task 6.x, closing the gap where an issued
 * capability could never be paid — `/pay` threw looking up a task budget
 * row that was never created):
 *
 * `maxTotalSpend` is derived from the resource registry's own `price` for
 * `resourceId` — read back from the just-persisted `CapabilityRecord`
 * (`getCapabilityRecord`), not from the request body's `exactAmount`
 * field, even though `issueCapability()` already guarantees the two are
 * equal by this point. This keeps the value entirely server/registry-
 * derived: the registry is closed and immutable at runtime (registry.ts),
 * so nothing about this lets a caller of `/issue` (a less-trusted caller
 * than whoever seeds the registry/creates tasks directly today) name or
 * influence its own spending cap — see the accompanying PR description
 * for the full risk analysis.
 *
 * Idempotent by design, not by accident: a `Task` is meant to have
 * multiple capabilities issued against it over its lifetime
 * (CAPABILITY_SPEC.md: `max_total_spend` is a ceiling "across all
 * capabilities issued against it", not a per-capability allowance).
 * `createTask()` itself throws on a duplicate `taskHash` (its PRIMARY KEY),
 * so this only calls it when no task exists yet for this `taskHash` —
 * a second `/issue` call for the same task definition just issues another
 * capability against the already-funded task, leaving its existing
 * budget/spentSoFar untouched, rather than erroring or double-funding it.
 */
export const issueRoute = new Hono();

issueRoute.post(
  "/",
  zValidator("json", issueRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_request", message: result.error.message }, 400);
    }
  }),
  async (c) => {
    const { taskDefinition, resourceId, exactAmount, paymentRequest, session } =
      c.req.valid("json");

    // Optional Chainlink CRE confidential spend-policy check (task 5.2).
    // Non-load-bearing: if disabled, misconfigured, or unreachable,
    // checkSpendPolicy returns { allowed: true } and issuance continues
    // exactly as it does without this check. Only an explicit { allowed:
    // false } from a reachable, enabled CRE gateway blocks issuance.
    // See docs/CHAINLINK_CRE_DESIGN.md and CAPABILITY_SPEC.md §"Chainlink
    // CRE optional policy check" for the full design rationale.
    const creResult = await checkSpendPolicy(resourceId, exactAmount);
    if (!creResult.allowed) {
      return c.json(
        { error: "spend_policy_exceeded", message: creResult.reason },
        403,
      );
    }

    try {
      const result = issueCapability({
        taskDefinition,
        resourceId,
        exactAmount,
        paymentRequest,
        session,
      });

      // Task budget creation (task 6.x) — see this file's top doc comment
      // for the full reasoning. Read back the just-persisted record rather
      // than trusting request-body fields directly.
      const record = getCapabilityRecord(result.capabilityId);
      if (record === undefined) {
        throw new Error(
          `POST /issue: capability "${result.capabilityId}" was just issued but getCapabilityRecord found no record for it`,
        );
      }

      if (getTask(record.capability.taskHash) === undefined) {
        const resource = getResourceById(record.capability.resourceId);
        if (resource === undefined) {
          throw new Error(
            `POST /issue: issueCapability() succeeded for resourceId "${record.capability.resourceId}" but getResourceById found no registry entry for it`,
          );
        }
        createTask(record.capability.taskHash, resource.price);
      }

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
