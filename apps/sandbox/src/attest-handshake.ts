/**
 * PayBound Agent Sandbox — attestation channel handshake caller (task 2.3).
 *
 * The sandbox half of docs/PROTOCOL.md §5: obtain a single-use challenge
 * from the Broker, sign it with the in-memory Ed25519 private key held by
 * `SandboxAttestation` (attestation.ts), and present the proof. Runs before
 * any untrusted content is read — see `runSandboxLifecycle`'s Step 1.5 in
 * agent.ts.
 *
 * **Fail-open when the Broker doesn't require attestation.** A `404` from
 * `/attest/challenge`, or a network-level failure reaching it, is treated
 * as "this Broker isn't running with ATTESTATION_ENABLED=true" and the
 * sandbox proceeds without blocking (docs/ATTESTATION_HANDSHAKE_DESIGN.md
 * §5). That is what keeps a gated-off Broker — the shipped default — from
 * breaking every sandbox run.
 *
 * A Broker that *does* require attestation and rejects the proof is a
 * different situation: the handshake reports `rejected`, and the sandbox's
 * subsequent `/issue` and `/pay` calls will get a 401 from the Broker
 * itself. This module never throws to force that outcome; the Broker
 * remains the sole authority on whether a request is allowed.
 */

import type { SandboxAttestation } from "./attestation.js";

export type HandshakeOutcome =
  /** Proof accepted; the channel is attested until `expiresAt`. */
  | { readonly status: "attested"; readonly expiresAt: string }
  /** Broker returned 404 / was unreachable — it does not require attestation. */
  | { readonly status: "not_required"; readonly detail: string }
  /** Broker required attestation and refused this proof. */
  | { readonly status: "rejected"; readonly detail: string };

export interface HandshakeOptions {
  /** Base URL of the Broker, e.g. `http://127.0.0.1:3000`. */
  readonly brokerBaseUrl: string;
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Performs the two-call handshake against `brokerBaseUrl`.
 * Never throws: every failure mode is reported as a `HandshakeOutcome`.
 */
export async function performAttestationHandshake(
  attestation: SandboxAttestation,
  options: HandshakeOptions,
): Promise<HandshakeOutcome> {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.brokerBaseUrl.replace(/\/+$/, "");

  // Step 1 — request a challenge.
  let challengeResponse: Response;
  try {
    challengeResponse = await fetchImpl(`${base}/attest/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: attestation.publicKey }),
    });
  } catch (error) {
    // Network-level failure — indistinguishable from "no such endpoint"
    // from here, so treated the same way: don't block the run.
    return {
      status: "not_required",
      detail: `could not reach ${base}/attest/challenge: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (challengeResponse.status === 404) {
    return {
      status: "not_required",
      detail: "Broker returned 404 from /attest/challenge (ATTESTATION_ENABLED is not true)",
    };
  }

  if (!challengeResponse.ok) {
    return {
      status: "rejected",
      detail: `/attest/challenge returned HTTP ${challengeResponse.status}`,
    };
  }

  let challenge: string;
  try {
    const body = (await challengeResponse.json()) as { challenge?: unknown };
    if (typeof body.challenge !== "string" || body.challenge.length === 0) {
      return { status: "rejected", detail: "/attest/challenge response had no challenge string" };
    }
    challenge = body.challenge;
  } catch (error) {
    return {
      status: "rejected",
      detail: `/attest/challenge response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  // Step 2 — sign it and present the proof.
  let verifyResponse: Response;
  try {
    verifyResponse = await fetchImpl(`${base}/attest/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attestation.createProof(challenge)),
    });
  } catch (error) {
    return {
      status: "rejected",
      detail: `could not reach ${base}/attest/verify: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (verifyResponse.status === 404) {
    return {
      status: "not_required",
      detail: "Broker returned 404 from /attest/verify (ATTESTATION_ENABLED is not true)",
    };
  }

  if (!verifyResponse.ok) {
    return { status: "rejected", detail: `/attest/verify returned HTTP ${verifyResponse.status}` };
  }

  const verified = (await verifyResponse.json()) as { expiresAt?: unknown };
  return {
    status: "attested",
    expiresAt: typeof verified.expiresAt === "string" ? verified.expiresAt : "",
  };
}
