import { AccountId, Client, PrivateKey } from "@hashgraph/sdk";
import { requireConfig } from "./config.js";

/** Creates a Hedera Testnet client using the broker's configured operator. */
export function createHederaClient(): Client {
  const { accountId, privateKey } = requireConfig();
  return Client.forTestnet().setOperator(AccountId.fromString(accountId), PrivateKey.fromStringDer(privateKey));
}

let cachedClient: Client | undefined;

/** Returns the configured client, creating it only when settlement is used. */
export function getHederaClient(): Client {
  cachedClient ??= createHederaClient();
  return cachedClient;
}