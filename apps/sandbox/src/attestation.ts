import { generateKeyPairSync, sign } from "node:crypto";
import { type AttestationProof, type PublicKey } from "@paybound/protocol";

/**
 * The proof shape and its verifier now live in `@paybound/protocol`, since
 * both sides of the handshake need them and `apps/broker` cannot import
 * `apps/sandbox`. Re-exported here so this module remains the single
 * sandbox-side entry point for attestation (docs/PROTOCOL.md §5).
 *
 * What deliberately does NOT move: `generateSandboxAttestation` and the
 * `createProof` closure below. They hold the ephemeral Ed25519 private
 * key, which must never leave this process — so the signing half stays
 * sandbox-local while only the public, verifying half is shared.
 */
export { verifyAttestationProof } from "@paybound/protocol";
export type { AttestationProof, PublicKey } from "@paybound/protocol";

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
