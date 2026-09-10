import { generateKeyPairSync, sign } from "node:crypto";

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
 * ---------------------------------------------------------------------
 * DELIBERATELY DUPLICATED — do not "fix" this into an import.
 * ---------------------------------------------------------------------
 * The canonical declaration of this shape lives in `@paybound/protocol`
 * (alongside `verifyAttestationProof`, the Broker's verifier), and
 * importing it from there is what you would normally do. It is redeclared
 * here on purpose, because this file is one of the three sources compiled
 * inside `apps/sandbox/Dockerfile`'s builder stage:
 *
 *     COPY . ./                       # build context is apps/sandbox ONLY
 *     sed -i '/"workspace:/d' package.json
 *     ...'include':['src/index.ts','src/config.ts','src/attestation.ts']
 *
 * That build strips every `workspace:*` dependency and cannot reach
 * `packages/` at all (the context is this directory), so any runtime or
 * type import of `@paybound/protocol` from this file fails the image
 * build with TS2307 — which breaks scaffold.test.ts, egress-policy.test.ts,
 * demo-harness.test.ts and network-boundary-demo.sh, all of which build
 * that image.
 *
 * The duplication is three field declarations and no logic. The part that
 * genuinely must not be duplicated — `verifyAttestationProof`, the actual
 * crypto — exists exactly once, in `@paybound/protocol`, and is imported
 * from there by the Broker and by this package's *tests* (which are not
 * Docker-compiled, so they can import it freely).
 *
 * If the Dockerfile ever stops stripping workspace deps (e.g. the build
 * context moves to the repo root), delete this interface and import it
 * from `@paybound/protocol` instead. See
 * docs/ATTESTATION_HANDSHAKE_DESIGN.md §5 for the full reasoning.
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
 *
 * This — the signing half — is what deliberately stays sandbox-local: it
 * closes over the private key, which must never leave this process. Only
 * the public, verifying half is shared via `@paybound/protocol`.
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
