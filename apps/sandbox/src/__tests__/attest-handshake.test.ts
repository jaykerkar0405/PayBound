/**
 * Sandbox-side attestation handshake caller (task 2.3,
 * docs/PROTOCOL.md §5, docs/ATTESTATION_HANDSHAKE_DESIGN.md §5).
 *
 * `fetch` is injected so these exercise the real two-call sequence and
 * the real signing (`generateSandboxAttestation`) without a running
 * Broker. The Broker-side counterpart is covered by apps/broker's
 * attest-route.test.ts; the two meet for real in the live verification
 * described in the PR.
 */
import { describe, expect, it } from "vitest";
import { generateSandboxAttestation } from "../attestation.js";
import { verifyAttestationProof } from "@paybound/protocol";
import { performAttestationHandshake } from "../attest-handshake.js";

const BROKER = "http://broker.test:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("performAttestationHandshake", () => {
  it("requests a challenge, signs it, presents the proof, and reports the attested window", async () => {
    const attestation = generateSandboxAttestation();
    const challenge = "a".repeat(64);
    const expiresAt = new Date(Date.now() + 1_800_000).toISOString();
    const calls: Array<{ url: string; body: unknown }> = [];

    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.endsWith("/attest/challenge")) return jsonResponse({ challenge, expiresAt });
      return jsonResponse({ attested: true, expiresAt });
    }) as unknown as typeof fetch;

    const outcome = await performAttestationHandshake(attestation, {
      brokerBaseUrl: BROKER,
      fetch: fetchImpl,
    });

    expect(outcome).toEqual({ status: "attested", expiresAt });

    // Two calls, in order, to the documented endpoints.
    expect(calls.map((c) => c.url)).toEqual([
      `${BROKER}/attest/challenge`,
      `${BROKER}/attest/verify`,
    ]);
    // First names the identity; second carries a genuinely valid proof
    // over the exact challenge the Broker handed back.
    expect(calls[0]!.body).toEqual({ publicKey: attestation.publicKey });
    const proof = calls[1]!.body as { publicKey: string; challenge: string; signature: string };
    expect(proof.publicKey).toBe(attestation.publicKey);
    expect(proof.challenge).toBe(challenge);
    expect(verifyAttestationProof(proof, challenge)).toBe(true);
  });

  it("treats a 404 from /attest/challenge as 'Broker does not require attestation' and does not attempt to verify", async () => {
    const attestation = generateSandboxAttestation();
    const calls: string[] = [];

    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return jsonResponse({ error: "attestation_not_enabled" }, 404);
    }) as unknown as typeof fetch;

    const outcome = await performAttestationHandshake(attestation, {
      brokerBaseUrl: BROKER,
      fetch: fetchImpl,
    });

    expect(outcome.status).toBe("not_required");
    // Stops after the challenge call — no point presenting a proof to a
    // Broker that doesn't want one.
    expect(calls).toEqual([`${BROKER}/attest/challenge`]);
  });

  it("treats an unreachable Broker as 'not required' rather than throwing, so a gated-off Broker never blocks a run", async () => {
    const attestation = generateSandboxAttestation();
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as unknown as typeof fetch;

    const outcome = await performAttestationHandshake(attestation, {
      brokerBaseUrl: BROKER,
      fetch: fetchImpl,
    });

    expect(outcome.status).toBe("not_required");
    if (outcome.status === "not_required") {
      expect(outcome.detail).toContain("ECONNREFUSED");
    }
  });

  it("reports 'rejected' when the Broker requires attestation but refuses the proof", async () => {
    const attestation = generateSandboxAttestation();

    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/attest/challenge")) {
        return jsonResponse({ challenge: "b".repeat(64), expiresAt: new Date().toISOString() });
      }
      return jsonResponse({ error: "attestation_failed", message: "nope" }, 401);
    }) as unknown as typeof fetch;

    const outcome = await performAttestationHandshake(attestation, {
      brokerBaseUrl: BROKER,
      fetch: fetchImpl,
    });

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.detail).toContain("401");
    }
  });

  it("never throws, whatever the Broker returns", async () => {
    const attestation = generateSandboxAttestation();
    const fetchImpl = (async () =>
      new Response("not json at all", { status: 200 })) as unknown as typeof fetch;

    await expect(
      performAttestationHandshake(attestation, { brokerBaseUrl: BROKER, fetch: fetchImpl }),
    ).resolves.toMatchObject({ status: "rejected" });
  });
});
