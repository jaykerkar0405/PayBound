export { config, requireConfig, requireTopicId, type Config } from "./config.js";
export { createHederaClient, getHederaClient } from "./hedera-client.js";
export {
    submitToHedera,
    queryHederaTransactionReceipt,
    type HederaSubmissionResult,
    type HederaReconciliationResult,
} from "./submit.js";

// HCS audit trail (task 4.2)
export {
    capabilityIssuedEventSchema,
    authorizationDecisionEventSchema,
    settlementOutcomeEventSchema,
    hcsEventSchema,
    type CapabilityIssuedEvent,
    type AuthorizationDecisionEvent,
    type SettlementOutcomeEvent,
    type HcsEvent,
} from "./hcs-schemas.js";
export { createAuditTopic } from "./hcs-topic.js";
export {
    logCapabilityIssued,
    logAuthorizationDecision,
    logSettlementOutcome,
} from "./hcs-log.js";
