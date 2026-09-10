import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { issueRequestSchema } from "@paybound/capability-spec";
import { issueCapability, getCapabilityRecord } from "../issuer.js";
import { checkSpendPolicy } from "../cre-policy.js";
import { createTask, getTask, getTaskResourceId } from "../budget.js";
import { getResourceById } from "../registry.js";
import { hashCanonical } from "../hash.js";

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
 *  - 409 when `taskDefinition` already names a task bound to a
 *    *different* resourceId (`TASK_RESOURCE_MISMATCH` — see below)
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
 * influence its own spending cap.
 *
 * **One resource per task (deliberate scope decision, not a TODO):** a
 * task's budget is bound to the single resourceId it was first created
 * for. Many capabilities can be issued against that same task+resource
 * pair over the task's lifetime (CAPABILITY_SPEC.md: `max_total_spend` is
 * a ceiling "across all capabilities issued against it", not a
 * per-capability allowance) — a second `/issue` call for the same
 * `taskDefinition` *and* the same `resourceId` just issues another
 * capability against the already-funded task, leaving its existing
 * budget/spentSoFar untouched.
 *
 * A second `/issue` call for the same `taskDefinition` but a *different*
 * `resourceId` is rejected outright with `409 TASK_RESOURCE_MISMATCH`,
 * checked before `issueCapability()` is even called (so no orphan
 * capability gets issued for a request that's ultimately refused). This
 * was deliberately narrowed from an earlier, broader "one task, many
 * resources" reading of CAPABILITY_SPEC.md: `maxTotalSpend`, derived from
 * a single resource's price, has no principled way to size itself for
 * multiple different resource prices sharing one task without silently
 * picking whichever `/issue` call happened to run first — which produced
 * confusing, order-dependent `BUDGET_EXCEEDED` rejections of otherwise
 * perfectly valid capabilities. See `budget.ts`'s `getTaskResourceId` for
 * how the binding is persisted and read.
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

    // One-resource-per-task check (task 6.x follow-up) — checked before
    // issueCapability() is called at all, so a rejected request never
    // leaves behind an orphan, never-payable capability. See this file's
    // top doc comment for the full reasoning.
    const taskHash = hashCanonical(taskDefinition);
    const boundResourceId = getTaskResourceId(taskHash);
    if (boundResourceId !== undefined && boundResourceId !== null && boundResourceId !== resourceId) {
      return c.json(
        {
          error: "task_resource_mismatch",
          message:
            `taskDefinition already names a task bound to resourceId "${boundResourceId}"; ` +
            `this request named a different resourceId "${resourceId}". A task's budget is ` +
            `bound to a single resource — see CAPABILITY_SPEC.md.`,
        },
        409,
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
        createTask(record.capability.taskHash, resource.price, record.capability.resourceId);
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
