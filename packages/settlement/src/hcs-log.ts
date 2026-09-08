/**
 * HCS message submission functions — one per audit event type.
 *
 * Each function serializes the event to JSON and submits it to the configured
 * HCS topic via TopicMessageSubmitTransaction. Returns the Hedera transaction
 * ID of the submission so callers can reference it in their own logs.
 *
 * @see docs.hedera.com → "Consensus Service" → "Submit a Message"
 * @see packages/settlement/src/hcs-schemas.ts for the event shapes
 */
import { TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { getHederaClient } from "./hedera-client.js";
import { requireTopicId } from "./config.js";
import type {
  CapabilityIssuedEvent,
  AuthorizationDecisionEvent,
  SettlementOutcomeEvent,
} from "./hcs-schemas.js";

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function submitHcsMessage(message: object): Promise<{ transactionId: string }> {
  const client = getHederaClient();
  const topicId = TopicId.fromString(requireTopicId());

  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify(message))
    .execute(client);

  // Wait for consensus receipt to confirm the message was accepted
  await response.getReceipt(client);

  return { transactionId: response.transactionId.toString() };
}

// ---------------------------------------------------------------------------
// Public logging functions
// ---------------------------------------------------------------------------

/**
 * Logs a capability-issuance event to HCS. Call this when the capability
 * issuer (task 1.3) produces a new Capability.
 *
 * Note: pass a `CapabilityIssuedEvent` — `nonce` is deliberately absent from
 * that type; never add it before calling this function.
 */
export async function logCapabilityIssued(
  event: CapabilityIssuedEvent,
): Promise<{ transactionId: string }> {
  return submitHcsMessage(event);
}

/**
 * Logs an authorization-decision event to HCS. Call this on every
 * Broker.authorize(payment) outcome, whether authorized or not.
 */
export async function logAuthorizationDecision(
  event: AuthorizationDecisionEvent,
): Promise<{ transactionId: string }> {
  return submitHcsMessage(event);
}

/**
 * Logs a settlement-outcome event to HCS. Call this after task 4.1's
 * `submitToHedera()` resolves, passing its `transactionId` and `status`
 * directly into the event.
 */
export async function logSettlementOutcome(
  event: SettlementOutcomeEvent,
): Promise<{ transactionId: string }> {
  return submitHcsMessage(event);
}

