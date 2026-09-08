import { randomUUID } from "node:crypto";
import {
  capabilityIdSchema,
  capabilitySchema,
  type Capability,
  type CapabilityId,
  type ResourceRegistryEntry,
} from "@paybound/capability-spec";
import { db } from "./db.js";
import { getResourceById } from "./registry.js";
import { canonicalize, hashCanonical } from "./hash.js";
import { stubSign } from "./signer.js";

/**
 * Issued capabilities: the ISSUED state per CAPABILITY_SPEC.md's payment
 * state machine. Stores every Capability field, plus the externally-facing
 * capabilityId (distinct from nonce — see docs/OPEN_QUESTIONS.md "Resolved:
 * capability_id vs. nonce"), the stub signature, and a consumed flag that
 * later tasks (1.5/1.6) burn atomically at the RESERVED transition.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS capabilities (
    capability_id          TEXT PRIMARY KEY,
    task_hash               TEXT NOT NULL,
    resource_id              TEXT NOT NULL,
    recipient                TEXT NOT NULL,
    exact_amount             TEXT NOT NULL,
    payment_request_hash     TEXT NOT NULL,
    session                  TEXT NOT NULL,
    nonce                    TEXT NOT NULL UNIQUE,
    expiry                   TEXT NOT NULL,
    max_uses                 INTEGER NOT NULL,
    signature                TEXT NOT NULL,
    consumed                 INTEGER NOT NULL DEFAULT 0
  )
`);

interface CapabilityRow {
  capability_id: string;
  task_hash: string;
  resource_id: string;
  recipient: string;
  exact_amount: string;
  payment_request_hash: string;
  session: string;
  nonce: string;
  expiry: string;
  max_uses: number;
  signature: string;
  consumed: number;
}

/** A persisted capability record, including issuer-internal bookkeeping not part of the Capability wire shape. */
export interface CapabilityRecord {
  readonly capabilityId: CapabilityId;
  readonly capability: Capability;
  readonly signature: string;
  readonly consumed: boolean;
}

function rowToRecord(row: CapabilityRow): CapabilityRecord {
  const capability: Capability = {
    taskHash: row.task_hash,
    resourceId: row.resource_id,
    recipient: row.recipient,
    exactAmount: row.exact_amount,
    paymentRequestHash: row.payment_request_hash,
    session: row.session,
    nonce: row.nonce,
    expiry: row.expiry,
    maxUses: 1,
  };

  return {
    capabilityId: capabilityIdSchema.parse(row.capability_id),
    capability,
    signature: row.signature,
    consumed: row.consumed !== 0,
  };
}

const insertStatement = db.prepare<
  [string, string, string, string, string, string, string, string, string, number, string, number]
>(`
  INSERT INTO capabilities (
    capability_id, task_hash, resource_id, recipient, exact_amount,
    payment_request_hash, session, nonce, expiry, max_uses, signature, consumed
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectByCapabilityIdStatement = db.prepare<[string], CapabilityRow>(
  "SELECT * FROM capabilities WHERE capability_id = ?",
);

/** Capabilities are short-lived by default (CAPABILITY_SPEC.md); fixed, not caller-configurable. */
const CAPABILITY_TTL_MS = 5 * 60 * 1000;

export interface IssueCapabilityInput {
  /** The canonical task definition; hashed (not stored verbatim) into `taskHash`. */
  readonly taskDefinition: unknown;
  /** Must correspond to an entry already seeded in the resource registry (task 1.2). */
  readonly resourceId: ResourceRegistryEntry["resourceId"];
  /** Must exactly match the registry entry's `price` — no dynamic pricing in the MVP. */
  readonly exactAmount: Capability["exactAmount"];
  /** The specific request being vetted; hashed (not stored verbatim) into `paymentRequestHash`. */
  readonly paymentRequest: unknown;
  /** The sandbox's attested workload identity. Accepted as trusted caller input; attestation itself is out of scope here (task 2.3). */
  readonly session: Capability["session"];
}

export interface IssueCapabilityResult {
  readonly capabilityId: CapabilityId;
  readonly expiry: Capability["expiry"];
}

/**
 * Produces a signed (stub-signed, per Phase 1) Capability object per
 * CAPABILITY_SPEC.md, with maxUses=1 and a short, fixed expiry. Rejects
 * issuance against an unknown resource or a requested exactAmount that
 * doesn't match the registry's price for that resource.
 */
export function issueCapability(input: IssueCapabilityInput): IssueCapabilityResult {
  const resource = getResourceById(input.resourceId);
  if (resource === undefined) {
    throw new Error(
      `issueCapability: resourceId "${input.resourceId}" is not a known resource registry entry`,
    );
  }

  if (input.exactAmount !== resource.price) {
    throw new Error(
      `issueCapability: exactAmount "${input.exactAmount}" does not match registry price "${resource.price}" for resource "${input.resourceId}"`,
    );
  }

  const taskHash = hashCanonical(input.taskDefinition);
  const paymentRequestHash = hashCanonical(input.paymentRequest);
  const nonce = randomUUID();
  const capabilityId = capabilityIdSchema.parse(randomUUID());
  const expiry = new Date(Date.now() + CAPABILITY_TTL_MS).toISOString();

  const capability: Capability = capabilitySchema.parse({
    taskHash,
    resourceId: input.resourceId,
    recipient: resource.recipient,
    exactAmount: input.exactAmount,
    paymentRequestHash,
    session: input.session,
    nonce,
    expiry,
    maxUses: 1,
  });

  const signature = stubSign(canonicalize(capability));

  insertStatement.run(
    capabilityId,
    capability.taskHash,
    capability.resourceId,
    capability.recipient,
    capability.exactAmount,
    capability.paymentRequestHash,
    capability.session,
    capability.nonce,
    capability.expiry,
    capability.maxUses,
    signature,
    0,
  );

  return { capabilityId, expiry: capability.expiry };
}

/** Reads back a full persisted capability record, for use by later tasks (1.5/1.6) and tests. */
export function getCapabilityRecord(capabilityId: CapabilityId): CapabilityRecord | undefined {
  const row = selectByCapabilityIdStatement.get(capabilityId);
  return row === undefined ? undefined : rowToRecord(row);
}
