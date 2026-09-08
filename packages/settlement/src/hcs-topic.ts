/**
 * One-time HCS topic creation for the PayBound audit trail.
 *
 * Run once to create a topic, then set the returned topic ID as
 * HEDERA_HCS_TOPIC_ID in your environment (following the same config.ts
 * pattern as HEDERA_TESTNET_ACCOUNT_ID from task 4.1).
 *
 * Usage (one-off):
 *   node --import tsx/esm src/hcs-topic.ts
 *
 * @see docs.hedera.com → "Consensus Service" → "Create a Topic"
 */
import { TopicCreateTransaction } from "@hashgraph/sdk";
import { getHederaClient } from "./hedera-client.js";

/**
 * Creates a new public HCS topic for the PayBound audit trail and returns
 * its topic ID as a string (e.g. "0.0.xxxxxx").
 *
 * The topic is created without an admin or submit key, making it a public
 * append-only log — anyone can submit messages and anyone can read them via
 * the mirror node. This is intentional: the point of HCS audit logging is
 * external verifiability, not access control.
 */
export async function createAuditTopic(): Promise<string> {
  const client = getHederaClient();

  const transaction = new TopicCreateTransaction().setTopicMemo(
    "PayBound audit trail — capability issuance, authorization decisions, settlement outcomes",
  );

  const response = await transaction.execute(client);
  const receipt = await response.getReceipt(client);

  if (receipt.topicId === null) {
    throw new Error("TopicCreateTransaction succeeded but returned no topicId.");
  }

  return receipt.topicId.toString();
}

// ---------------------------------------------------------------------------
// One-off script entry point
// ---------------------------------------------------------------------------
// When this file is executed directly (not imported), create the topic and
// print the ID so the operator can set it as HEDERA_HCS_TOPIC_ID.

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("hcs-topic.ts") || process.argv[1].endsWith("hcs-topic.js"));

if (isMain) {
  createAuditTopic()
    .then((topicId) => {
      console.log("✅ HCS topic created:", topicId);
      console.log("Set this as your environment variable:");
      console.log(`  HEDERA_HCS_TOPIC_ID=${topicId}`);
      console.log("View on HashScan:");
      console.log(`  https://hashscan.io/testnet/topic/${topicId}`);
    })
    .catch((err: unknown) => {
      console.error("❌ Failed to create HCS topic:", err);
      process.exit(1);
    });
}

