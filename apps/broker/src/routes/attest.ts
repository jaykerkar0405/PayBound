import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  attestationChallengeRequestSchema,
  attestationProofSchema,
} from "@paybound/capability-spec";
import {
  isAttestationEnabled,
  issueChallenge,
  verifyAndRecordAttestation,
} from "../attestation.js";

/**
 * POST /attest/challenge and POST /attest/verify — the Broker half of the
 * sandbox attestation channel handshake (task 2.3, docs/PROTOCOL.md §5,
 * docs/ATTESTATION_HANDSHAKE_DESIGN.md §1).
 *
 * Two calls, not one: the Broker must generate and hand back a challenge
 * before the sandbox can sign it, so a challenge-response handshake
 * inherently needs two round trips. Kept as dedicated endpoints rather
 * than folded into `/issue`, so `/issue`'s and `/pay`'s already-audited
 * wire shapes are completely unchanged (PROTOCOL.md §2's "exactly one
 * parameter" principle for `/pay` in particular).
 *
 * This authenticates the **channel**, not any individual payment
 * (PROTOCOL.md §5). It is not one of the 9 invariant clauses and does not
 * touch `Broker.authorize()`.
 *
 * **Gating:** when `ATTESTATION_ENABLED` is not `"true"`, both routes
 * return `404`. That's deliberate and load-bearing for the sandbox side:
 * a sandbox attempts the handshake unconditionally and treats a 404 as
 * "this Broker doesn't require attestation," proceeding without blocking
 * (design doc §5). A 404 is therefore how a gated-off Broker advertises
 * that, rather than a silent 200 that would look like a successful
 * handshake that never happened.
 */
export const attestRoute = new Hono();

/** Shared by both routes — see the gating note in this file's doc comment. */
const NOT_ENABLED_BODY = {
  error: "attestation_not_enabled",
  message:
    "This Broker is not running with ATTESTATION_ENABLED=true; no channel handshake is required or accepted.",
} as const;

attestRoute.post(
  "/challenge",
  zValidator("json", attestationChallengeRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_request", message: result.error.message }, 400);
    }
  }),
  (c) => {
    if (!isAttestationEnabled()) {
      return c.json(NOT_ENABLED_BODY, 404);
    }

    const { publicKey } = c.req.valid("json");
    const { challenge, expiresAt } = issueChallenge(publicKey);

    return c.json({ challenge, expiresAt }, 200);
  },
);

attestRoute.post(
  "/verify",
  zValidator("json", attestationProofSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_request", message: result.error.message }, 400);
    }
  }),
  (c) => {
    if (!isAttestationEnabled()) {
      return c.json(NOT_ENABLED_BODY, 404);
    }

    const proof = c.req.valid("json");
    const result = verifyAndRecordAttestation(proof);

    if (!result.ok) {
      // Distinct from `attestation_required` (returned by /issue and /pay
      // when no handshake was ever completed): this one means a handshake
      // was attempted and failed. See design doc §3.
      return c.json(
        {
          error: "attestation_failed",
          message: `Attestation proof rejected: ${result.reason}.`,
        },
        401,
      );
    }

    return c.json({ attested: true, expiresAt: result.expiresAt }, 200);
  },
);
