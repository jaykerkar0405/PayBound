import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { generateSandboxAttestation, type SandboxAttestation } from "../attestation.js";
// The verifier lives in @paybound/protocol (one implementation, shared with
// the Broker). It is imported here rather than through ../attestation.js
// because that file cannot import workspace packages — see the
// "DELIBERATELY DUPLICATED" note there. Test files are not compiled by the
// sandbox Dockerfile, so they can import it directly.
import { verifyAttestationProof } from "@paybound/protocol";
import { initializeAttestation, getSandboxIdentity } from "../index.js";

describe("Sandbox Attested Workload Identity (Task 2.3)", () => {
  it("generates an ephemeral keypair exposing a valid PublicKey-shaped value", () => {
    const attestation = generateSandboxAttestation();

    expect(attestation.publicKey).toBeDefined();
    expect(typeof attestation.publicKey).toBe("string");
    // Ed25519 SPKI DER public key is 44 bytes = 88 hex characters
    expect(attestation.publicKey).toMatch(/^[0-9a-fA-F]{88}$/);
  });

  it("produces a valid signature for a given challenge that verifies against the public key", () => {
    const attestation = generateSandboxAttestation();
    const challenge = randomBytes(32).toString("hex");

    const proof = attestation.createProof(challenge);

    expect(proof.publicKey).toBe(attestation.publicKey);
    expect(proof.challenge).toBe(challenge);
    expect(typeof proof.signature).toBe("string");
    expect(proof.signature.length).toBeGreaterThan(0);

    // Verify proof
    const isValid = verifyAttestationProof(proof, challenge);
    expect(isValid).toBe(true);
  });

  it("fails verification when a signature is presented against a different challenge (non-replay)", () => {
    const attestation = generateSandboxAttestation();
    const originalChallenge = randomBytes(32).toString("hex");
    const replayedChallenge = randomBytes(32).toString("hex");

    const proof = attestation.createProof(originalChallenge);

    // Verifying proof against a different challenge must fail
    const isValid = verifyAttestationProof(proof, replayedChallenge);
    expect(isValid).toBe(false);

    // Tampering with the challenge inside the proof must also fail verification
    const tamperedProof = {
      ...proof,
      challenge: replayedChallenge,
    };
    const isTamperedValid = verifyAttestationProof(tamperedProof, replayedChallenge);
    expect(isTamperedValid).toBe(false);
  });

  it("fails verification if the signature is validated against an unrelated public key", () => {
    const attestation1 = generateSandboxAttestation();
    const attestation2 = generateSandboxAttestation();
    const challenge = randomBytes(32).toString("hex");

    const proof1 = attestation1.createProof(challenge);

    // Spoofed public key with signature from another identity
    const spoofedProof = {
      ...proof1,
      publicKey: attestation2.publicKey,
    };

    expect(verifyAttestationProof(spoofedProof, challenge)).toBe(false);
  });

  it("produces two distinct keypairs across two separate sandbox initializations", () => {
    const attestation1 = generateSandboxAttestation();
    const attestation2 = generateSandboxAttestation();

    expect(attestation1.publicKey).not.toBe(attestation2.publicKey);
  });

  it("ensures attestation identity is established before any simulated untrusted content read step", () => {
    let identityAtContentRead: SandboxAttestation | null = null;

    // Simulated startup lifecycle
    function simulateStartup(onUntrustedContentRead: () => void): void {
      // 1. Establish attested identity first
      initializeAttestation();

      // 2. Simulated agent loop begins reading untrusted content
      onUntrustedContentRead();
    }

    simulateStartup(() => {
      // Capture identity when content reading commences
      identityAtContentRead = getSandboxIdentity();
    });

    expect(identityAtContentRead).not.toBeNull();
    const activePubKey = (identityAtContentRead as unknown as SandboxAttestation).publicKey;
    expect(activePubKey).toBeDefined();
    expect(typeof activePubKey).toBe("string");
    expect(activePubKey).toMatch(/^[0-9a-fA-F]{88}$/);
  });
});
