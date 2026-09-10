import { randomBytes } from "node:crypto";
import { verifyAttestationProof, type AttestationProof } from "@paybound/protocol";

/**
 * Broker-side state for the sandbox attestation channel handshake
 * (task 2.3, docs/PROTOCOL.md §5, docs/ATTESTATION_HANDSHAKE_DESIGN.md §2).
 *
 * Two in-memory maps, deliberately **not** persisted to SQLite:
 *
 *  - Attestation proves *current, live* possession of a private key, not
 *    a durable fact. If the Broker restarts, requiring the sandbox to
 *    re-attest (one local crypto verify, no external calls) is the
 *    correct behaviour, not a gap to route around. This is the opposite
 *    of `payment_submissions`/`tasks`/`capabilities`, which are persisted
 *    precisely because they represent money that must survive a crash
 *    (CAPABILITY_SPEC.md's `RECOVERABLE` state exists for that).
 *  - Keeping it out of the DB means zero new tables and zero migrations.
 *
 * Expiry is lazy (checked on read): an entry past its expiry is treated
 * as absent and can be overwritten by a fresh challenge/attestation.
 * There is no background sweep — a very long-lived Broker would retain
 * small expired map entries. Known, low-severity, and consistent with the
 * rest of this codebase, which has no background jobs except
 * `sweepRecoverablePayments` (which has a durability reason this
 * doesn't share).
 */

/** A challenge that has been issued but not yet successfully proven. */
interface PendingChallenge {
  readonly challenge: string;
  readonly expiresAt: number;
}

/** A session that has successfully completed the handshake. */
interface VerifiedAttestation {
  readonly expiresAt: number;
}

/** Keyed by the sandbox's `publicKey` (the same value that becomes `session` on any capability issued for it). */
const pendingChallenges = new Map<string, PendingChallenge>();
const verifiedAttestations = new Map<string, VerifiedAttestation>();

/**
 * Reads gating/TTL config lazily from `process.env` rather than the
 * frozen `config` snapshot — same pattern as `isSettlementConfigured()`
 * (settlement.ts) and `cre-policy.ts`'s deps, so tests can toggle
 * per-case without re-importing the module.
 */
export function isAttestationEnabled(): boolean {
  return process.env.ATTESTATION_ENABLED === "true";
}

function attestationTtlMs(): number {
  return Number(process.env.ATTESTATION_TTL_MS ?? 30 * 60 * 1000);
}

function challengeTtlMs(): number {
  return Number(process.env.ATTESTATION_CHALLENGE_TTL_MS ?? 60 * 1000);
}

export interface IssuedChallenge {
  readonly challenge: string;
  /** ISO 8601, for the wire response. */
  readonly expiresAt: string;
}

/**
 * Issues a single-use, high-entropy challenge bound to `publicKey`
 * (PROTOCOL.md §5). Any previously-issued, unused challenge for the same
 * publicKey is replaced — only the most recent one is ever accepted.
 */
export function issueChallenge(publicKey: string): IssuedChallenge {
  const challenge = randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + challengeTtlMs();

  pendingChallenges.set(publicKey, { challenge, expiresAt: expiresAtMs });

  return { challenge, expiresAt: new Date(expiresAtMs).toISOString() };
}

export type VerifyAttestationResult =
  | { readonly ok: true; readonly expiresAt: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Completes the handshake: confirms the proof's challenge is the one
 * this Broker actually issued to that publicKey, that it hasn't expired,
 * and that the Ed25519 signature verifies (`verifyAttestationProof`,
 * @paybound/protocol). On success, records the session as attested for
 * `ATTESTATION_TTL_MS` and burns the challenge so it cannot be reused.
 *
 * The challenge is consumed on *any* verification attempt, successful or
 * not — a failed attempt cannot be retried against the same challenge,
 * which is what makes it genuinely single-use.
 */
export function verifyAndRecordAttestation(proof: AttestationProof): VerifyAttestationResult {
  const pending = pendingChallenges.get(proof.publicKey);
  pendingChallenges.delete(proof.publicKey);

  if (pending === undefined) {
    return { ok: false, reason: "no challenge has been issued for this publicKey" };
  }

  if (Date.now() >= pending.expiresAt) {
    return { ok: false, reason: "the challenge issued for this publicKey has expired" };
  }

  if (!verifyAttestationProof(proof, pending.challenge)) {
    return { ok: false, reason: "signature or challenge did not verify against this publicKey" };
  }

  const expiresAtMs = Date.now() + attestationTtlMs();
  verifiedAttestations.set(proof.publicKey, { expiresAt: expiresAtMs });

  return { ok: true, expiresAt: new Date(expiresAtMs).toISOString() };
}

/**
 * Whether `session` currently has a live, verified attestation.
 *
 * Callers (`/issue`, `/pay`) must only consult this when
 * `isAttestationEnabled()` is true — this function answers "is this
 * session attested," not "should this request be allowed."
 */
export function isAttested(session: string): boolean {
  const record = verifiedAttestations.get(session);
  if (record === undefined) return false;

  if (Date.now() >= record.expiresAt) {
    verifiedAttestations.delete(session);
    return false;
  }

  return true;
}

/** Test-only: drops all handshake state. Not used by any request path. */
export function _resetAttestationStateForTests(): void {
  pendingChallenges.clear();
  verifiedAttestations.clear();
}
