/**
 * `@paybound/protocol` — the shared half of the Broker↔Agent-Sandbox wire
 * protocol (docs/PROTOCOL.md), for contract pieces both `apps/broker` and
 * `apps/sandbox` need. The two apps have no dependency on each other (they
 * are separate deployable services that only ever talk over HTTP), so
 * anything genuinely shared between them lives here.
 *
 * Wire *shapes* (Zod schemas + their types) live in `@paybound/types` and
 * are re-exported through `@paybound/capability-spec`, per this repo's
 * existing convention. This package holds shared protocol *logic* — today,
 * the attestation proof verification both sides are defined against.
 */
export {
  verifyAttestationProof,
  type AttestationProof,
  type PublicKey,
} from "./attestation.js";
