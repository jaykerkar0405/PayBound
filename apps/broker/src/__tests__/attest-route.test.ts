/**
 * Broker-side attestation channel handshake (task 2.3, docs/PROTOCOL.md §5,
 * docs/ATTESTATION_HANDSHAKE_DESIGN.md).
 *
 * Uses the real sandbox-side signing primitive (`generateSandboxAttestation`
 * from @paybound/protocol's counterpart in apps/sandbox) reimplemented here
 * via node:crypto directly, because apps/broker cannot import apps/sandbox —
 * the two are separate deployable services with no dependency on each other.
 * The verification side under test is the real shared one
 * (`verifyAttestationProof`, @paybound/protocol), which is exactly what the
 * sandbox's own proofs are verified against in production.
 */
import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { app } from "../index.js";
import { _resetAttestationStateForTests } from "../attestation.js";

/**
 * Local stand-in for apps/sandbox's `generateSandboxAttestation` — same
 * Ed25519/SPKI-DER-hex construction, same signing, so the proofs produced
 * here are byte-identical in shape to a real sandbox's.
 */
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

async function postChallenge(body: unknown) {
  return app.request("/attest/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postVerify(body: unknown) {
  return app.request("/attest/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Completes a full handshake and returns the identity that now holds it. */
async function completeHandshake() {
  const identity = makeIdentity();
  const challengeRes = await postChallenge({ publicKey: identity.publicKey });
  const { challenge } = (await challengeRes.json()) as { challenge: string };
  const verifyRes = await postVerify(identity.createProof(challenge));
  return { identity, verifyRes };
}

afterEach(() => {
  delete process.env.ATTESTATION_ENABLED;
  delete process.env.ATTESTATION_TTL_MS;
  delete process.env.ATTESTATION_CHALLENGE_TTL_MS;
  _resetAttestationStateForTests();
});

describe("POST /attest/* — gating (ATTESTATION_ENABLED unset/false)", () => {
  it("returns 404 from /attest/challenge when attestation is not enabled, so a sandbox can detect it isn't required", async () => {
    const identity = makeIdentity();

    const res = await postChallenge({ publicKey: identity.publicKey });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("attestation_not_enabled");
  });

  it("returns 404 from /attest/verify when attestation is not enabled", async () => {
    const identity = makeIdentity();

    const res = await postVerify(identity.createProof("some-challenge"));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("attestation_not_enabled");
  });

  it("is off by default: ATTESTATION_ENABLED unset behaves the same as explicitly false", async () => {
    const identity = makeIdentity();
    expect(process.env.ATTESTATION_ENABLED).toBeUndefined();
    const unsetRes = await postChallenge({ publicKey: identity.publicKey });

    process.env.ATTESTATION_ENABLED = "false";
    const falseRes = await postChallenge({ publicKey: identity.publicKey });

    expect(unsetRes.status).toBe(404);
    expect(falseRes.status).toBe(404);
  });
});

describe("POST /attest/challenge", () => {
  it("issues a high-entropy challenge with an expiry when enabled", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();

    const res = await postChallenge({ publicKey: identity.publicKey });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string; expiresAt: string };
    // randomBytes(32) hex-encoded
    expect(body.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("issues a different challenge on every call", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();

    const first = (await (await postChallenge({ publicKey: identity.publicKey })).json()) as {
      challenge: string;
    };
    const second = (await (await postChallenge({ publicKey: identity.publicKey })).json()) as {
      challenge: string;
    };

    expect(first.challenge).not.toBe(second.challenge);
  });

  it("returns 400 invalid_request when publicKey is missing", async () => {
    process.env.ATTESTATION_ENABLED = "true";

    const res = await postChallenge({});

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });
});

describe("POST /attest/verify", () => {
  it("accepts a valid proof and returns the attested window", async () => {
    process.env.ATTESTATION_ENABLED = "true";

    const { verifyRes } = await completeHandshake();

    expect(verifyRes.status).toBe(200);
    const body = (await verifyRes.json()) as { attested: boolean; expiresAt: string };
    expect(body.attested).toBe(true);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a proof whose signature was made by a different key (spoofed publicKey)", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const realIdentity = makeIdentity();
    const attacker = makeIdentity();

    const { challenge } = (await (
      await postChallenge({ publicKey: realIdentity.publicKey })
    ).json()) as { challenge: string };

    // Attacker signs the real identity's challenge with its own key, but
    // claims to be the real identity.
    const forged = { ...attacker.createProof(challenge), publicKey: realIdentity.publicKey };
    const res = await postVerify(forged);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("attestation_failed");
    expect(body.message).toContain("did not verify");
  });

  it("rejects a proof carrying a challenge this Broker never issued (mismatched challenge)", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();

    await postChallenge({ publicKey: identity.publicKey });
    const res = await postVerify(identity.createProof("a-challenge-the-broker-never-issued"));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("attestation_failed");
  });

  it("rejects a proof when no challenge was ever issued for that publicKey", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();

    const res = await postVerify(identity.createProof("unsolicited"));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("attestation_failed");
    expect(body.message).toContain("no challenge has been issued");
  });

  it("rejects an expired challenge", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    // Expire immediately: any elapsed time is already past the TTL.
    process.env.ATTESTATION_CHALLENGE_TTL_MS = "0";
    const identity = makeIdentity();

    const { challenge } = (await (
      await postChallenge({ publicKey: identity.publicKey })
    ).json()) as { challenge: string };
    const res = await postVerify(identity.createProof(challenge));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("attestation_failed");
    expect(body.message).toContain("expired");
  });

  it("rejects a replayed challenge: a challenge is single-use, even when the proof itself is valid", async () => {
    process.env.ATTESTATION_ENABLED = "true";
    const identity = makeIdentity();

    const { challenge } = (await (
      await postChallenge({ publicKey: identity.publicKey })
    ).json()) as { challenge: string };
    const proof = identity.createProof(challenge);

    const first = await postVerify(proof);
    expect(first.status).toBe(200);

    // Exactly the same, still-cryptographically-valid proof, replayed.
    const replay = await postVerify(proof);

    expect(replay.status).toBe(401);
    const body = (await replay.json()) as { error: string; message: string };
    expect(body.error).toBe("attestation_failed");
    expect(body.message).toContain("no challenge has been issued");
  });

  it("returns 400 invalid_request for a structurally malformed proof", async () => {
    process.env.ATTESTATION_ENABLED = "true";

    const res = await postVerify({ publicKey: "abc" }); // missing challenge + signature

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });
});
