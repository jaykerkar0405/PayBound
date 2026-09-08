/**
 * Centralized Hedera Testnet configuration for the settlement package.
 * Other modules import `config`/`requireConfig`/`requireTopicId` from here
 * rather than reading `process.env` directly — following the same pattern as
 * apps/broker/src/config.ts.
 */
export interface Config {
    readonly accountId: string | undefined;
    readonly privateKey: string | undefined;
    /**
     * The HCS topic ID for the PayBound audit trail. Created once via
     * `createAuditTopic()` (hcs-topic.ts) and set as an env var thereafter.
     */
    readonly hcsTopicId: string | undefined;
}

export const config: Config = {
    accountId: process.env.HEDERA_TESTNET_ACCOUNT_ID,
    privateKey: process.env.HEDERA_TESTNET_PRIVATE_KEY,
    hcsTopicId: process.env.HEDERA_HCS_TOPIC_ID,
};

export function requireConfig(): { readonly accountId: string; readonly privateKey: string } {
    if (config.accountId === undefined || config.privateKey === undefined) {
        throw new Error(
            "Hedera Testnet configuration is missing: set HEDERA_TESTNET_ACCOUNT_ID and HEDERA_TESTNET_PRIVATE_KEY.",
        );
    }

    return { accountId: config.accountId, privateKey: config.privateKey };
}

/** Guards that HEDERA_HCS_TOPIC_ID is set, throwing if not. Reads process.env
 *  lazily (not from the frozen `config` snapshot) so tests that set
 *  HEDERA_HCS_TOPIC_ID dynamically in beforeAll are handled correctly. */
export function requireTopicId(): string {
    const topicId = process.env.HEDERA_HCS_TOPIC_ID ?? config.hcsTopicId;
    if (topicId === undefined) {
        throw new Error(
            "HCS topic ID is missing: run createAuditTopic() once and set HEDERA_HCS_TOPIC_ID.",
        );
    }

    return topicId;
}