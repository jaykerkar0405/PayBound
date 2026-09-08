import { generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from "node:crypto";

/**
 * Hex-encoded Ed25519 public key in SPKI DER format.
 * Matches `PublicKey` from `@paybound/types` (which is defined as a string).
 */
export type PublicKey = string;

/**
 * Attestation proof returned during the channel handshake with the Broker.
 * Conforms to docs/PROTOCOL.md §5:
 * 1. Identity: publicKey matching the session field (PublicKey).
 * 2. Freshness / non-replay: ed25519 signature over a single-use challenge.
 */
export interface AttestationProof {
  readonly publicKey: PublicKey;
  readonly challenge: string;
  readonly signature: string;
}

/**
 * Sandbox-side interface for the attested workload identity.
 * Created before any untrusted content is read (THREAT_MODEL.md).
 * Holds the private key strictly in-memory (never logged or written to disk).
 */
export interface SandboxAttestation {
  readonly publicKey: PublicKey;
  createProof(challenge: string): AttestationProof;
}

/**
 * Generates an ephemeral in-memory Ed25519 keypair for the sandbox workload.
 * The public key serves as the `session` identifier (PublicKey).
 */
export function generateSandboxAttestation(): SandboxAttestation {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  // Export as SPKI DER in hex encoding
  const pubHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  return {
    publicKey: pubHex,
    createProof(challenge: string): AttestationProof {
      if (!challenge || typeof challenge !== "string") {
        throw new Error("Attestation challenge must be a non-empty string");
      }
      const signature = sign(null, Buffer.from(challenge, "utf-8"), privateKey).toString("hex");

      return {
        publicKey: pubHex,
        challenge,
        signature,
      };
    },
  };
}

/**
 * Verifies an attestation proof against an expected challenge.
 * Used by verifiers (the Broker or test harness) to confirm identity and freshness.
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
