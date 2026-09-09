import { createHash } from "node:crypto";

/**
 * Builds the bytes `ledgerSign` (signer.ts) hands to the Ledger Hedera
 * app's `INS_SIGN_TRANSACTION` — task 3.2 (issue 45).
 *
 * Why this exists: `state-machine.ts`'s `submitPayment` signs
 * `canonicalize(reserved.capability)` — an arbitrary JSON string, not a
 * Hedera protobuf `TransactionBody`. That's fine for the Phase 1-3 stub
 * signer (it's just a placeholder signature), but the real device app
 * `pb_decode`s whatever bytes it receives as `Hedera.TransactionBody`
 * (LedgerHQ/app-hedera's `sign_transaction.c`) and rejects anything that
 * isn't a structurally valid one — confirmed empirically against Speculos +
 * a build of app-hedera at the commit cited in
 * docs/LEDGER_HEDERA_RESEARCH.md: the raw canonicalized-JSON payload comes
 * back as status word 0x6E00 (`EXCEPTION_MALFORMED_APDU`), not a signature.
 *
 * `packages/settlement` is now wired in (task 4.1,
 * docs/SETTLEMENT_INTEGRATION_PROPOSAL.md "Design A") — but as a
 * deliberately separate signing domain, not through this function or
 * `submitPayment`: `apps/broker/src/settlement.ts`'s `settleAndRecord`
 * calls `packages/settlement` directly from routes/pay.ts, after
 * `submitPayment` has already returned, using its own configured operator
 * key to build and sign the real on-chain `TransferTransaction`.
 * `state-machine.ts`'s `submitPayment` still only ever signs
 * `canonicalize(reserved.capability)` via this function's dummy
 * transaction, unchanged. There is still no real recipient/amount pair in
 * Hedera's own terms (a `shard.realm.num` account ID, a tinybar amount) to
 * encode *here* in general — `capability.recipient` isn't guaranteed to be
 * a Hedera account ID outside of whatever the resource registry happens to
 * contain (see property.test.ts's "0xRECIPIENT" placeholders) — so this
 * function's approach remains necessary for what it proves: the Broker's
 * own Ledger-backed authorization signature, independent of settlement.
 *
 * So rather than fabricate a recipient/amount the device would render as
 * if it meant something real, this builds the smallest transaction the
 * device app will actually accept and sign — a fixed, clearly-dummy
 * 1-tinybar transfer between two placeholder accounts (0.0.1 -> 0.0.2) —
 * and binds it to the *actual* payment by putting a SHA-256 digest of the
 * real payload in the transaction's `memo` field (also real Hedera
 * protobuf, not a workaround). Anyone reviewing the on-device screen sees
 * that digest and can independently verify it against the payload being
 * authorized. `hederaTransactionSigner` (signer.ts) — not this function —
 * remains the integration seam for routing *real* settlement signing
 * through the Ledger (`@hashgraph/sdk`'s `transaction.signWith(...)`
 * already produces real, fully-formed `TransactionBody` bytes with a real
 * recipient/amount, needing no wrapping at all), a bigger change than
 * Design A attempts — see the proposal doc's "Design B" for what that
 * would require and why it wasn't done here.
 *
 * Protobuf shape (field numbers verified directly against
 * LedgerHQ/app-hedera's proto/transaction_body.proto,
 * proto/crypto_transfer.proto, proto/basic_types.proto at the commit cited
 * in docs/LEDGER_HEDERA_RESEARCH.md, and the resulting bytes verified to
 * `pb_decode` and pass `sign_transaction.c`'s `validate_transfer` against
 * a real Speculos-emulated build of that app):
 *
 *   TransactionBody {
 *     memo: string = 6                                  // <= 100 chars
 *     cryptoTransfer: CryptoTransferTransactionBody = 14 // oneof `data`
 *   }
 *   CryptoTransferTransactionBody { transfers: TransferList = 1 }
 *   TransferList { accountAmounts: repeated AccountAmount = 1 }  // exactly 2
 *   AccountAmount {
 *     accountID: AccountID = 1
 *     amount: sint64 = 2       // sums to zero across the 2 entries
 *   }
 *   AccountID { accountNum: int64 = 3 }  // shardNum/realmNum omitted: 0 is
 *                                        // proto3's default, so encoding
 *                                        // them is unnecessary
 *
 * Hand-encoded rather than pulled in via a protobuf library/`@hashgraph/sdk`
 * (only used by packages/settlement, a different phase's concern) — this is
 * a handful of fixed fields, in keeping with this package's existing
 * from-source approach (see apdu.ts, hid-framing.ts).
 */

const SENDER_ACCOUNT_NUM = 1;
const RECIPIENT_ACCOUNT_NUM = 2;
const DUMMY_TRANSFER_AMOUNT_TINYBARS = 1;

/** Max varint this module ever needs to encode; keeps `encodeVarint` simple. */
function encodeVarint(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`hedera-transaction-body: expected a non-negative integer varint, got ${value}`);
  }

  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLengthDelimitedField(fieldNumber: number, content: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(content.length), content]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

/** Protobuf `sint64`: zigzag-encoded so small negative values stay small. */
function encodeSint64Field(fieldNumber: number, value: number): Buffer {
  const zigzag = value >= 0 ? value * 2 : -value * 2 - 1;
  return encodeVarintField(fieldNumber, zigzag);
}

function encodeStringField(fieldNumber: number, value: string): Buffer {
  return encodeLengthDelimitedField(fieldNumber, Buffer.from(value, "utf8"));
}

function encodeAccountAmount(accountNum: number, amountTinybars: number): Buffer {
  const accountId = encodeVarintField(3, accountNum); // AccountID.accountNum
  return Buffer.concat([
    encodeLengthDelimitedField(1, accountId), // AccountAmount.accountID
    encodeSint64Field(2, amountTinybars), // AccountAmount.amount
  ]);
}

/**
 * Builds a minimal, device-app-acceptable `Hedera.TransactionBody` whose
 * `memo` is bound to `payload` via a SHA-256 digest. See this file's top
 * comment for why the transfer itself is a fixed dummy amount rather than
 * derived from the payment being authorized.
 */
export function buildSignableHederaTransactionBody(payload: string): Buffer {
  const memo = createHash("sha256").update(payload, "utf8").digest("hex"); // 64 chars, within the 100-char memo cap

  const transferList = Buffer.concat([
    encodeLengthDelimitedField(1, encodeAccountAmount(SENDER_ACCOUNT_NUM, -DUMMY_TRANSFER_AMOUNT_TINYBARS)),
    encodeLengthDelimitedField(1, encodeAccountAmount(RECIPIENT_ACCOUNT_NUM, DUMMY_TRANSFER_AMOUNT_TINYBARS)),
  ]);
  const cryptoTransferBody = encodeLengthDelimitedField(1, transferList); // CryptoTransferTransactionBody.transfers

  return Buffer.concat([
    encodeStringField(6, memo), // TransactionBody.memo
    encodeLengthDelimitedField(14, cryptoTransferBody), // TransactionBody.cryptoTransfer (oneof `data`)
  ]);
}
