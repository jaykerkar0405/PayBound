/**
 * Real Hedera Testnet integration tests for the HCS audit logging functions.
 *
 * These tests:
 * 1. Create a fresh HCS topic (one per test run via beforeAll)
 * 2. Submit one message of each event type via hcs-log.ts's functions
 * 3. Poll the Hedera mirror node REST API to confirm the messages were
 *    actually recorded (not just that TopicMessageSubmitTransaction returned
 *    a success receipt — we read the messages back and assert their content)
 *
 * Guard: guarded by describe.skipIf(!HEDERA_TESTNET_ACCOUNT_ID) — the same
 * convention as submit.test.ts (task 4.1). In environments without testnet
 * credentials, all tests in this suite are skipped rather than failing.
 *
 * Mirror node propagation: HCS messages typically appear on the mirror node
 * within a few seconds of consensus. We poll every 2s up to 20s to avoid
 * flaky false failures.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createAuditTopic } from "../hcs-topic.js";
import {
  logCapabilityIssued,
  logAuthorizationDecision,
  logSettlementOutcome,
} from "../hcs-log.js";
import { hcsEventSchema } from "../hcs-schemas.js";
import type {
  CapabilityIssuedEvent,
  AuthorizationDecisionEvent,
  SettlementOutcomeEvent,
} from "../hcs-schemas.js";

// ---------------------------------------------------------------------------
// Credential guard
// ---------------------------------------------------------------------------

const hasTestnetCredentials = process.env.HEDERA_TESTNET_ACCOUNT_ID !== undefined &&
  process.env.HEDERA_TESTNET_PRIVATE_KEY !== undefined;

// ---------------------------------------------------------------------------
// Mirror node polling helper
// ---------------------------------------------------------------------------

interface MirrorMessage {
  consensus_timestamp: string;
  message: string; // base64-encoded
}

interface MirrorResponse {
  messages: MirrorMessage[];
}

/**
 * Polls the Hedera Testnet mirror node for messages on `topicId`, retrying
 * every 2s up to `timeoutMs` (default 20s) to allow for propagation delay.
 * Returns decoded message objects (parsed from base64 JSON).
 */
async function pollMirrorNode(
  topicId: string,
  expectedCount: number,
  timeoutMs = 20_000,
): Promise<unknown[]> {
  const url = `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as MirrorResponse;
      if (data.messages.length >= expectedCount) {
        return data.messages.map((m) =>
          JSON.parse(Buffer.from(m.message, "base64").toString("utf8")),
        );
      }
    }
    // Wait 2s before retrying
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Mirror node did not return ${String(expectedCount)} messages for topic ${topicId} within ${String(timeoutMs)}ms`,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!hasTestnetCredentials)("HCS audit logging — real Hedera Testnet", () => {
  let topicId: string;

  // Create a fresh topic for this test run so messages don't mix with other runs
  beforeAll(async () => {
    topicId = await createAuditTopic();
    // Set the topic ID in the process env so the logging functions can pick it up
    process.env.HEDERA_HCS_TOPIC_ID = topicId;
    console.log("Created HCS topic for test:", topicId);
    console.log(`HashScan: https://hashscan.io/testnet/topic/${topicId}`);
  }, 30_000);

  it(
    "logCapabilityIssued: submits a capability_issued message and reads it back from mirror node",
    async () => {
      const event: CapabilityIssuedEvent = {
        eventType: "capability_issued",
        timestamp: new Date().toISOString(),
        taskHash: "test-task-hash",
        resourceId: "test-resource-id",
        recipient: process.env.HEDERA_TESTNET_ACCOUNT_ID ?? "0.0.2",
        exactAmount: "0.00000001",
        paymentRequestHash: "test-payment-request-hash",
        session: "test-session-key",
        expiry: "2999-01-01T00:00:00.000Z",
      };

      const { transactionId } = await logCapabilityIssued(event);
      expect(transactionId).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);

      // Poll mirror node and assert the message was recorded
      const messages = await pollMirrorNode(topicId, 1);
      const parsed = hcsEventSchema.parse(messages[0]);
      expect(parsed.eventType).toBe("capability_issued");
      if (parsed.eventType === "capability_issued") {
        expect(parsed.taskHash).toBe(event.taskHash);
        expect(parsed.resourceId).toBe(event.resourceId);
      }
    },
    60_000, // 60s — topic creation + submission + mirror node propagation
  );

  it(
    "logAuthorizationDecision: submits both a success and a failure event and reads them back",
    async () => {
      const successEvent: AuthorizationDecisionEvent = {
        eventType: "authorization_decision",
        timestamp: new Date().toISOString(),
        taskHash: "test-task-hash",
        resourceId: "test-resource-id",
        authorized: true,
        reason: null,
      };

      const failureEvent: AuthorizationDecisionEvent = {
        eventType: "authorization_decision",
        timestamp: new Date().toISOString(),
        taskHash: "test-task-hash",
        resourceId: "test-resource-id",
        authorized: false,
        reason: "SUBSTITUTION",
      };

      const [r1, r2] = await Promise.all([
        logAuthorizationDecision(successEvent),
        logAuthorizationDecision(failureEvent),
      ]);
      expect(r1.transactionId).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);
      expect(r2.transactionId).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);

      // Poll for 3 messages total (1 from previous test + 2 from this one)
      const messages = await pollMirrorNode(topicId, 3);
      const authMessages = messages
        .map((m) => hcsEventSchema.parse(m))
        .filter((e) => e.eventType === "authorization_decision");

      expect(authMessages.length).toBeGreaterThanOrEqual(2);

      const success = authMessages.find((e) => e.eventType === "authorization_decision" && e.authorized === true);
      const failure = authMessages.find((e) => e.eventType === "authorization_decision" && e.authorized === false);

      expect(success).toBeDefined();
      expect(failure).toBeDefined();
      if (failure?.eventType === "authorization_decision") {
        expect(failure.reason).toBe("SUBSTITUTION");
      }
    },
    60_000,
  );

  it(
    "logSettlementOutcome: submits a settlement_outcome message and reads it back",
    async () => {
      const event: SettlementOutcomeEvent = {
        eventType: "settlement_outcome",
        timestamp: new Date().toISOString(),
        taskHash: "test-task-hash",
        hederaTransactionId: "0.0.10421552@1788877278.359927796",
        status: "SUCCESS",
      };

      const { transactionId } = await logSettlementOutcome(event);
      expect(transactionId).toMatch(/^\d+\.\d+\.\d+@\d+\.\d+$/);

      // Poll for 4 messages total (3 previous + 1 new)
      const messages = await pollMirrorNode(topicId, 4);
      const outcomeMessages = messages
        .map((m) => hcsEventSchema.parse(m))
        .filter((e) => e.eventType === "settlement_outcome");

      expect(outcomeMessages.length).toBeGreaterThanOrEqual(1);
      const outcome = outcomeMessages[0];
      if (outcome?.eventType === "settlement_outcome") {
        expect(outcome.hederaTransactionId).toBe(event.hederaTransactionId);
        expect(outcome.status).toBe("SUCCESS");
      }
    },
    60_000,
  );
});

