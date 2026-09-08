import { AccountId, Hbar, TransferTransaction } from "@hashgraph/sdk";
import type { SubmittedPaymentState } from "@paybound/capability-spec";
import { requireConfig } from "./config.js";
import { getHederaClient } from "./hedera-client.js";

export interface HederaSubmissionResult {
  readonly transactionId: string;
  readonly status: string;
}

/** Submits the payment described by a broker-produced SUBMITTED state. */
export async function submitToHedera(
  submitted: SubmittedPaymentState,
): Promise<HederaSubmissionResult> {
  const { accountId } = requireConfig();
  const amount = Hbar.fromString(submitted.capability.exactAmount);
  const client = getHederaClient();
  const transactionResponse = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(accountId), amount.negated())
    .addHbarTransfer(AccountId.fromString(submitted.capability.recipient), amount)
    .execute(client);
  const receipt = await transactionResponse.getReceipt(client);

  return {
    transactionId: transactionResponse.transactionId.toString(),
    status: receipt.status.toString(),
  };
}