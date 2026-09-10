/**
 * The attestation pre-check on POST /issue and POST /pay (task 2.3,
 * docs/ATTESTATION_HANDSHAKE_DESIGN.md §§3-4).
 *
 * Two things under test, and the second matters more than the first:
 *  1. When ATTESTATION_ENABLED=true, an unattested session is rejected
 *     with 401 attestation_required, and an attested one proceeds.
 *  2. When ATTESTATION_ENABLED is unset/false — the shipped default —
 *     both routes behave exactly as they always have, regardless of
 *     whether any attestation exists. The gate must be a genuine no-op
 *     when off, not merely "usually off."
 *
 * Signing is done locally via node:crypto (same Ed25519/SPKI-DER-hex
 * construction as apps/sandbox's generateSandboxAttestation) because
 * apps/broker cannot import apps/sandbox; the verification side exercised
 * here is the real shared one from @paybound/protocol.
 */
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { app } from "../index.js";
import { seedRegistry } from "../registry.js";
import { _resetAttestationStateForTests } from "../attestation.js";

function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return {
    publicKey: publicKeyHex,
    createProof(challenge: string) {
      return {
        publicKey: publicKeyHex,
        challenge,
        signature: sign(null, Buffer.from(challenge, "utf-8"), privateKey).toString("hex"),
      };
    },
  };
}

async function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Seeds a fresh registry entry and returns an /issue body bound to `session`. */
function issueBodyFor(session: string, price = "10.00") {
  const resourceId = randomUUID();
  seedRegistry([{ resourceId, recipient: "0xRECIPIENT", price }]);
  return {
    taskDefinition: { scenario: "attestation-gate", nonce: randomUUID() },
    resourceId,
    exactAmount: price,
    paymentRequest: { detail: "attestation-gate" },
    session,
  };
}

/** Runs the full handshake for `identity`. Requires ATTESTATION_ENABLED=true. */
async function attest(identity: ReturnType<typeof makeIdentity>) {
  const challengeRes = await post("/attest/challenge", { publicKey: identity.publicKey });
  const { challenge } = (await challengeRes.json()) as { challenge: string };
  const verifyRes = await post("/attest/verify", identity.createProof(challenge));
  expect(verifyRes.status).toBe(200);
}

afterEach(() => {
  delete process.env.ATTESTATION_ENABLED;
  _resetAttestationStateForTests();
});

describe("attestation gate — ATTESTATION_ENABLED=true (fail-closed)", () => {
  it("rejects POST /issue with 401 attestation_required when the session has no live attestation", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();

    const res = await post("/issue", issueBodyFor(identity.publicKey));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("attestation_required");
    expect(body.message).toContain("channel handshake");
  });

  it("allows POST /issue once the session has completed the handshake", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();
    await attest(identity);

    const res = await post("/issue", issueBodyFor(identity.publicKey));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { capabilityId: string };
    expect(typeof body.capabilityId).toBe("string");
  });

  it("rejects POST /pay with 401 attestation_required for a capability whose bound session is unattested", async () => {
    // Issue the capability with the gate OFF, so it exists and is payable...
    const identity = makeIdentity();
    const issueRes = await post("/issue", issueBodyFor(identity.publicKey));
    expect(issueRes.status).toBe(200);
    const { capabilityId } = (await issueRes.json()) as { capabilityId: string };

    // ...then turn the gate ON without ever performing a handshake.
    process.env.ATTESTATION_ENABLED = "true";
    const res = await post("/pay", { capabilityId });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("attestation_required");
  });

  it("does not leak attestation between sessions: attesting one identity does not authorize another's capability", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const attestedIdentity = makeIdentity();
    const otherIdentity = makeIdentity();
    await attest(attestedIdentity);

    // Capability bound to the OTHER, unattested session.
    const issueRes = await post("/issue", issueBodyFor(otherIdentity.publicKey));
    expect(issueRes.status).toBe(401);

    // And the attested identity's own issuance still works, proving the
    // rejection above is session-scoped, not a blanket failure.
    const ownRes = await post("/issue", issueBodyFor(attestedIdentity.publicKey));
    expect(ownRes.status).toBe(200);
  });

  it("allows a full issue -> pay flow end to end for an attested session", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();
    await attest(identity);

    const issueRes = await post("/issue", issueBodyFor(identity.publicKey));
    expect(issueRes.status).toBe(200);
    const { capabilityId } = (await issueRes.json()) as { capabilityId: string };

    const payRes = await post("/pay", { capabilityId });

    expect(payRes.status).toBe(200);
    const payBody = (await payRes.json()) as { state?: { status: string } };
    expect(payBody.state?.status).toBe("SUBMITTED");
  });
});

describe("attestation gate — ATTESTATION_ENABLED unset/false (the shipped default)", () => {
  it("allows POST /issue and POST /pay with no handshake ever performed", async () => {
    expect(process.env.ATTESTATION_ENABLED).toBeUndefined();
    const identity = makeIdentity();

    const issueRes = await post("/issue", issueBodyFor(identity.publicKey));
    expect(issueRes.status).toBe(200);
    const { capabilityId } = (await issueRes.json()) as { capabilityId: string };

    const payRes = await post("/pay", { capabilityId });

    expect(payRes.status).toBe(200);
    const payBody = (await payRes.json()) as { state?: { status: string } };
    expect(payBody.state?.status).toBe("SUBMITTED");
  });

  it("allows POST /issue and POST /pay when explicitly disabled, even though attestation state exists for a different session", async () => {
    // Establish a real attestation for one identity while enabled...
    process.env.ATTESTATION_ENABLED = "true";
    const attestedIdentity = makeIdentity();
    await attest(attestedIdentity);

    // ...then disable the gate and act as a completely unattested session.
    process.env.ATTESTATION_ENABLED = "false";
    const unattested = makeIdentity();

    const issueRes = await post("/issue", issueBodyFor(unattested.publicKey));
    expect(issueRes.status).toBe(200);
    const { capabilityId } = (await issueRes.json()) as { capabilityId: string };

    const payRes = await post("/pay", { capabilityId });
    expect(payRes.status).toBe(200);
  });
});
