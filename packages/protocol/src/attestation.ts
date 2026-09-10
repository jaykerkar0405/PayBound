import { verify, createPublicKey, type KeyObject } from "node:crypto";

/**
 * Hex-encoded Ed25519 public key in SPKI DER format.
 * Matches `PublicKey` from `@paybound/types` (which is defined as a string).
 */
export type PublicKey = string;

/**
 * Attestation proof presented during the channel handshake with the Broker.
 * Conforms to docs/PROTOCOL.md §5:
 * 1. Identity: publicKey matching the session field (PublicKey).
 * 2. Freshness / non-replay: ed25519 signature over a single-use challenge.
 *
 * Lives here, in `@paybound/protocol`, rather than in `apps/sandbox`,
 * because both sides of the handshake need it: the sandbox constructs a
 * proof (`createProof`, apps/sandbox/src/attestation.ts — which keeps the
 * private key and must never leave that process), and the Broker verifies
 * one (`verifyAttestationProof` below). `apps` cannot import each other,
 * so the shared half of the wire contract belongs in a package —
 * specifically this one, whose documented role in ARCHITECTURE.md's
 * "Mapping onto the repo" table is exactly "Wire protocol for the
 * `pay(capability_id)` channel, including attested identity handshake."
 */
export interface AttestationProof {
  readonly publicKey: PublicKey;
  readonly challenge: string;
  readonly signature: string;
}

/**
 * Verifies an attestation proof against an expected challenge.
 *
 * Returns `true` only if the proof is structurally complete, its
 * `challenge` matches `expectedChallenge` exactly (non-replay), and the
 * Ed25519 signature over that challenge verifies against the proof's own
 * `publicKey` (live possession of the private key).
 *
 * Pure and side-effect free: it does not know or care where
 * `expectedChallenge` came from. Binding a challenge to a specific
 * publicKey, enforcing single use, and expiring it are the caller's job —
 * see `apps/broker/src/attestation.ts`, which holds that state.
 */
export function verifyAttestationProof(
  proof: AttestationProof,
  expectedChallenge: string,
): boolean {
  if (!proof || !proof.publicKey || !proof.challenge || !proof.signature) {
    return false;
  }
  if (proof.challenge !== expectedChallenge) {
    return false;
  }

  try {
    const keyObj: KeyObject = createPublicKey({
      key: Buffer.from(proof.publicKey, "hex"),
      format: "der",
      type: "spki",
    });

    return verify(
      null,
      Buffer.from(proof.challenge, "utf-8"),
      keyObj,
      Buffer.from(proof.signature, "hex"),
    );
  } catch {
    return false;
  }
}
