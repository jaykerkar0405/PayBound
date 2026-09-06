/**
 * Runtime validation for the shapes defined in @paybound/types.
 *
 * @paybound/types is the source of truth for the *shape*; this package is the
 * source of truth for *runtime validation* of that shape. Schemas use Zod's
 * `.readonly()` so a successfully-parsed value is frozen (Object.freeze) at
 * runtime, matching the `readonly`/`Readonly<...>` compile-time types.
 *
 * Placeholder fields — will be finalized alongside docs/TASKS.md 0.3.
 */
import { z } from "zod";
import type { Capability, PayRequest, PayResponse, Task } from "@paybound/types";

export const capabilitySchema = z
  .object({
    taskHash: z.string(),
    resourceId: z.string(),
    recipient: z.string(),
    exactAmount: z.string(),
    paymentRequestHash: z.string(),
    session: z.string(),
    nonce: z.string(),
    expiry: z.string(),
    maxUses: z.literal(1),
  })
  .readonly();

export const taskSchema = z
  .object({
    taskHash: z.string(),
    maxTotalSpend: z.string(),
    spentSoFar: z.string(),
  })
  .readonly();

export const payRequestSchema = z.object({ capabilityId: z.string() }).readonly();

export const payResponseSchema = z
  .object({
    state: z.enum(["ISSUED", "RESERVED", "SUBMITTED", "SETTLED", "RECOVERABLE", "FAILED"]),
    paymentId: z.string(),
  })
  .readonly();

// Compile-time check that the Zod-inferred shape stays assignable to the
// hand-written types in @paybound/types — if the two drift apart, this file
// fails to type-check.
type _AssertCapability = z.infer<typeof capabilitySchema> extends Capability ? true : never;
type _AssertTask = z.infer<typeof taskSchema> extends Task ? true : never;
type _AssertPayRequest = z.infer<typeof payRequestSchema> extends PayRequest ? true : never;
type _AssertPayResponse = z.infer<typeof payResponseSchema> extends PayResponse ? true : never;

export type { Capability, Task, PayRequest, PayResponse } from "@paybound/types";
