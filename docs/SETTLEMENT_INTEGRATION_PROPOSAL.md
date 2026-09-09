# Settlement Integration Proposal (tasks 4.1 → wiring into `apps/broker`)

**Status:** Design A implemented (`feat/4.1-settlement-wiring`) — see
`apps/broker/src/settlement.ts`, `apps/broker/src/hcs-audit.ts`, and the
updated `packages/settlement/src/submit.ts`. Designs B and C below remain
unimplemented follow-on work. Originally written as investigation-only on
2026-09-09, ~2 days before the Sept 13 deadline (`docs/TASKS.md`); this
status line is the only part updated after implementation — the rest of
the document is left as originally written.

This document answers the four questions posed for this investigation, in
order: (1) confirm/correct the "never wired in" finding, (2) answer the
structural question of whether the Ledger's signature can actually sign a
real Hedera transaction, (3) propose 2–3 concrete integration designs, and
(4) flag anything that needs nontrivial new work in `packages/ledger-signer`
specifically, since that changes the risk profile this close to the
deadline.

---

## 1. Is `packages/settlement` genuinely never imported by `apps/broker`?

**Confirmed — yes, with no partial wiring of any kind.**

```
$ grep -rln "@paybound/settlement" . --include=*.ts --include=*.json \
    | grep -v node_modules | grep -v "^./packages/settlement"
(no output)
```

Nothing in the repo — not `apps/broker`, not tests, not scripts — imports
`@paybound/settlement`. There is no commented-out call, no feature flag
gating it, and no reference to it anywhere outside its own package and
prose comments in `apps/broker` that explicitly say it *isn't* wired yet
(`apps/broker/src/hedera-transaction-body.ts:18-20`, `signer.ts:52,89`,
`state-machine.ts:217-220`). `apps/broker/package.json` does not list
`@paybound/settlement` as a dependency at all.

Separately, `packages/settlement` has no `test` script in its
`package.json` (`build`/`check-types`/`lint` only), so `pnpm turbo run test`
silently skips it entirely — even its own two test files
(`submit.test.ts`, `hcs-log.test.ts`) have never executed in any CI or
local run reachable from the standard commands, since they're
`describe.skipIf(!hasTestnetCredentials)`-gated and no `HEDERA_TESTNET_*`
env vars exist anywhere in this repo/environment.

**Net: this is a real, standalone, fully-built package that has never been
exercised end-to-end or called from anywhere.**

---

## 2. Can the Ledger's signature actually sign a real Hedera transaction?

**Short answer: structurally plausible, and I got new empirical evidence
in this session that makes it *more* plausible than the code comments
alone suggested — but it is not a proven, ready-to-use capability. Treat
it as "worth a scoped verification spike," not "just flip it on."**

### What's already decided and built

- **Curve: ECDSA secp256k1**, not Ed25519 — a deliberate decision
  (`docs/OPEN_QUESTIONS.md` "Resolved: Ledger signing curve mismatch").
  Hedera supports both `Ed25519` and `ECDSAsecp256k1` account key types, so
  secp256k1 is one of the two the SDK natively understands — this is not a
  foreign curve to Hedera.
- **The APDU response is the raw signature, nothing else**
  (`packages/ledger-signer/src/apdu.ts`'s `parseSignTransactionResponse`
  just strips the 2-byte status word and returns what's left).
- **A real integration seam already exists and is already correctly
  typed for `@hashgraph/sdk`:** `signer.ts`'s `hederaTransactionSigner`
  returns `(message: Uint8Array) => Promise<Uint8Array>` — which is
  *exactly* the signature `Transaction.signWith` expects:

  ```ts
  // node_modules/@hashgraph/sdk/lib/transaction/Transaction.d.ts
  signWith(publicKey: PublicKey, transactionSigner: (message: Uint8Array) => Promise<Uint8Array>): Promise<this>;
  ```

  This wasn't written blind — `signer.ts`'s doc comment on `ledgerSign`
  explicitly names this as "the seam ... where a real recipient/amount
  will actually flow through once packages/settlement is wired into this
  flow." Whoever built task 3.2 already designed for this integration; it
  was never finished, not never planned.

### What I verified empirically in this session (new information — not
previously confirmed by any doc, comment, or test in the repo)

I started a real Speculos instance and called `signHederaPayload` directly
against it, signing a real `buildSignableHederaTransactionBody` output
(the same function `state-machine.ts` uses today):

```
SIGNATURE_HEX: aa995c2d8b1ca6d557befeae737adb329d17b0ae37bdd4209a36525e2835261598ad0c41afd15684f144255ab8fdf246f3e25a7ffd5f593916e5ccfa13ccc60e
SIGNATURE_LENGTH_BYTES: 64
FIRST_BYTE_HEX: aa
```

- **Exactly 64 bytes, every time (repeated 3x, byte-identical — the app
  signs deterministically, RFC 6979-style, not with a random nonce).**
- The first byte is `0xaa`, not `0x30`. A DER-encoded ECDSA signature
  always starts with `0x30` (the ASN.1 SEQUENCE tag) and is essentially
  never exactly 64 bytes (DER overhead plus two variable-length integers
  almost always lands in the 70–72 byte range for a 256-bit curve).
  **64 bytes with no DER tag is strong evidence this is a raw, fixed-width
  `r‖s` concatenation (32 bytes r + 32 bytes s)** — which is *precisely*
  the format Hedera's protobuf `SignaturePair.ECDSAsecp256k1` field
  expects (a raw 64-byte value, no DER wrapping, no recovery byte —
  unlike Ethereum, Hedera does not need a recovery id in the signature
  itself).

This is a good sign, but it stops short of proof: I confirmed the *shape*
looks right, not that Hedera's own consensus nodes accept it. Nobody has
taken this signature and successfully submitted a real, `signWith()`-signed
transaction to Hedera testnet. That full path — construct a real
`TransferTransaction`, `.freezeWith(client)`, `.signWith(publicKey,
hederaTransactionSigner(keyIndex))`, `.execute(client)` — has **zero**
existing code or test coverage anywhere in this repo.

### The gap this doesn't close: there is no public-key retrieval

`signWith(publicKey, ...)` needs a `PublicKey` object
(`PublicKey.fromBytesECDSA(bytes)` exists in `@hashgraph/sdk` for exactly
this). **`packages/ledger-signer` only implements `INS_SIGN_TRANSACTION`
(`0x04`) — there is no `INS_GET_PUBLIC_KEY` support at all**
(`apdu.ts`'s only exported command builder is `buildSignTransactionApdu`;
grepping the package for `getPublicKey`/`GET_PUBLIC_KEY` returns nothing
except a comment noting `hw-app-hedera`'s JS wrapper *does* expose
`getPublicKey`, which this project deliberately bypassed in favor of a
custom APDU client that only implements signing).

This means: to actually use the Ledger's key for real settlement, someone
needs the corresponding public key from *somewhere*. Options are (a) add
`INS_GET_PUBLIC_KEY` support to `packages/ledger-signer` (new code,
unresearched — `docs/LEDGER_HEDERA_RESEARCH.md` never investigated this
instruction, only `INS_SIGN_TRANSACTION`), or (b) derive/read it once
out-of-band (e.g., a one-off script against Speculos, or `hw-app-hedera`'s
existing `getPublicKey` binding used just once, manually) and hardcode it
as broker config. (b) avoids new package code but is a manual,
undocumented, easy-to-get-wrong operational step — and it would need
redoing if the demo ever moves off the fixed Speculos dev seed.

There is also an *operational* (not code) gap: whichever Hedera account is
meant to actually hold/pay out testnet HBAR needs to exist and be funded,
and — for Design B below — needs its account key to actually be that
Ledger-derived public key. Nothing in this repo creates or funds that
account today.

### Bottom line for question 2

**Yes, this looks achievable, and the byte-format compatibility question —
the part that would have been a hard blocker if the answer were "DER" or
"needs a recovery byte" — comes back favorable based on real evidence
gathered in this session.** But "the signature shape is probably right"
and "getting a public key to pair it with, funding a matching account, and
proving the whole `signWith` path actually settles on real Hedera testnet"
are two different amounts of remaining work. The first is close to done;
the second is an unstarted, untested integration with real external
dependencies (a funded testnet account) that can't be fully verified
without a live spike.

---

## 3. Integration designs

All three assume the same trigger-point analysis, confirmed directly
against code this session:

- **`pay()` is still exactly as `PROTOCOL.md` §1 describes: synchronous
  through signing/`SUBMITTED`, nothing async happens after.**
  `apps/broker/src/routes/pay.ts` calls `await submitPayment(...)`, builds
  the HTTP response from the resulting `SubmittedPaymentState`, and
  returns. Its own comment says this explicitly: *"settlement
  (resolveSubmission) is deliberately not called here (docs/PROTOCOL.md
  §1)."* This is accurate, current, unchanged.
- **The hook point already exists and needs no new state-machine work.**
  `state-machine.ts`'s `resolveSubmission(submitted, outcome)` already
  implements the exact `SUBMITTED → SETTLED/FAILED/RECOVERABLE` mapping
  task 4.3 describes — it just needs a caller that (a) actually calls
  `packages/settlement`, (b) maps whatever comes back (or a
  timeout/connection error) to `"settled" | "failed" | "unknown"`, and (c)
  calls `resolveSubmission()` with it. Nobody needs to touch the state
  machine's transition logic itself.
- **The natural place to add that caller is right after
  `pay.ts`'s `const submitted = await submitPayment(...)` line** — either
  as a fire-and-forget continuation (`void settleAsync(submitted)`, not
  awaited by the HTTP response) or handed off to a background
  worker/queue. Either way, the HTTP response still returns immediately
  after `SUBMITTED`, preserving `PROTOCOL.md`'s contract unchanged.

### Design A — Minimal wiring, settlement and Ledger-signature stay two separate concerns (recommended given ~2 days)

- **Trigger:** fire-and-forget continuation in `pay.ts`, right after
  `submitPayment` resolves — call it, don't await it in the response path.
- **Who signs the real on-chain `TransferTransaction`:** the existing
  `packages/settlement` code, unchanged — `HEDERA_TESTNET_PRIVATE_KEY` as
  the Hedera Client operator, exactly as `submit.ts` does today.
- **What changes about the Ledger signature's purpose:** nothing. It
  continues to mean exactly what it means today — the Broker's own
  internal proof that its Ledger-backed key attested to this capability
  (signed over the dummy 1-tinybar tx + memo-hash-bound payload). It does
  not touch real funds and its meaning doesn't change.
- **Work required:** call `submitToHedera(submitted)`; map its resolved
  receipt `status` (e.g. `"SUCCESS"` → `"settled"`, anything else
  definitive → `"failed"`) or a thrown error/timeout → `"unknown"`, into
  `resolveSubmission(submitted, outcome)`; call the three existing
  `logCapabilityIssued` / `logAuthorizationDecision` / `logSettlementOutcome`
  functions at their natural call sites (issuer.ts, authorize.ts's call
  site in pay.ts, and after the settlement outcome above, respectively);
  wire `HEDERA_TESTNET_ACCOUNT_ID` / `HEDERA_TESTNET_PRIVATE_KEY` /
  `HEDERA_HCS_TOPIC_ID` into broker config/env docs; add `@paybound/settlement`
  as a real dependency of `apps/broker`; update the stale "not wired in"
  comments (`hedera-transaction-body.ts`, `signer.ts`, `state-machine.ts`)
  and `ARCHITECTURE.md`'s "optional trust service" framing if it becomes
  load-bearing for the demo's Moment. A basic reconciliation path for
  `RECOVERABLE` (task 4.3's "query by transaction ID") is small on top of
  this, since `packages/settlement` already has `getHederaClient()` and
  the SDK's `TransactionId`-based receipt query is a few lines — worth
  doing in the same pass rather than leaving `RECOVERABLE` a dead end.
- **Risk: LOW.** No cryptography changes, no new `packages/ledger-signer`
  work, no untested signature paths. The only real external dependency is
  a funded Hedera testnet account and a pre-created HCS topic — both pure
  ops/config, not code. This comfortably fits in the remaining time,
  including tests (either against a real funded testnet account, matching
  the existing `hasTestnetCredentials`-gated test pattern, or by mocking
  `@paybound/settlement` at the `apps/broker` boundary for CI and relying
  on `packages/settlement`'s own — currently unexercised — tests for the
  real-network path).

### Design B — Route real settlement signing through the Ledger (the seam's originally-intended use)

- **Trigger:** same point as Design A.
- **Who signs:** the Ledger's own key becomes the actual paying account's
  key. `submit.ts` would build the `TransferTransaction`,
  `.freezeWith(client)`, `.signWith(ledgerPublicKey,
  hederaTransactionSigner(keyIndex))`, then `.execute()` —
  `HEDERA_TESTNET_PRIVATE_KEY` either disappears entirely (if the
  Ledger-keyed account also pays its own fees) or narrows to a separate
  fee-payer/operator role while the Ledger-keyed account only supplies the
  transfer-side signature (two sub-variants, both real Hedera SDK
  patterns, neither implemented or tested here).
- **What changes about the Ledger signature's purpose:** fundamentally.
  It stops being an internal audit artifact and becomes the actual
  fund-authorizing signature on a real, live Hedera transaction. That's a
  meaningfully higher correctness bar — a bug here risks real (if only
  testnet-valued) funds behaving unexpectedly, not just a malformed audit
  log entry.
- **Work required, beyond Design A:** everything flagged in §4 below —
  most notably public-key retrieval and a funded, Ledger-keyed testnet
  account — plus replacing `hedera-transaction-body.ts`'s dummy-tx
  approach at the `submitPayment` call site with the real frozen
  `TransferTransaction` bytes (a signature-interface change: today
  `submitPayment`'s `signer` parameter is `(payload: string) => string |
  Promise<string>`; `hederaTransactionSigner` is `(message: Uint8Array) =>
  Promise<Uint8Array>` — these don't compose without a new code path,
  since `submitPayment` currently signs *before* a real transaction body
  would even exist, and a real `TransferTransaction`'s bytes are only
  available after `packages/settlement` builds one).
- **Risk: MEDIUM–HIGH given ~2 days.** This is the option the task asked
  me to flag explicitly — see §4. It touches unverified cryptography
  end-to-end, an account-funding/key-provisioning step with no existing
  tooling, and a real architectural change to how `submitPayment` and
  `packages/settlement` relate to each other, not just new glue code. I
  would not attempt this before the deadline; it's a good documented
  follow-up, not a 2-day task.

### Design C — Hybrid: keep Design A's real settlement path, but have the Ledger additionally co-sign the *real* transaction for the audit trail

- **Trigger:** same point as A/B, after `packages/settlement` has built
  the real (frozen) `TransferTransaction` bytes.
- **Who signs the real on-chain transfer:** same as Design A — the
  operator key, unchanged. Funds custody doesn't move.
- **What's new:** *in addition*, call `hederaTransactionSigner` with the
  real frozen transaction bytes (not the dummy tx `hedera-transaction-body.ts`
  builds today) purely to produce an extra signature that gets logged into
  the HCS settlement-outcome audit event — proof, independently verifiable
  by anyone with the Ledger's public key, that the Broker's Ledger-backed
  key specifically attested to *this real transaction*, not a placeholder
  bound only by a memo hash. This directly closes the gap
  `hedera-transaction-body.ts`'s own doc comment calls out ("no real
  recipient/amount encoded here").
- **What changes about the Ledger signature's purpose:** it expands (now
  also attests to the real transaction) but stays non-load-bearing for
  actual fund movement — nothing about custody or the settlement path
  itself changes.
- **Risk: MEDIUM**, lower than B: no funded Ledger-keyed account needed
  (the signature is published as audit evidence, not submitted to Hedera
  as a required `SignaturePair`), but it still needs the public-key
  question resolved (§4) for the audit entry to be independently
  checkable, and it still needs the real-transaction-bytes plumbing change
  Design B needs. Worth calling out as a strong stretch goal *after*
  Design A is solid, not a replacement for it.

**Recommendation:** ship **Design A** given the time remaining, explicitly
document Designs B/C as follow-on work in `docs/OPEN_QUESTIONS.md` or
`docs/TASKS.md`, and update the stale "packages/settlement, a different
phase's concern" comments once A lands so they don't keep telling the next
reader something no longer true.

---

## 4. Explicit flags: nontrivial new work in `packages/ledger-signer` itself

Only relevant to Designs B and C, **not** Design A (which needs zero
changes to `packages/ledger-signer`). Flagging these separately because
they're a different risk category from `apps/broker` wiring — they touch
device-signing code with a much thinner safety net (no real hardware,
Speculos-only, as already documented in the package's own "Known
limitation" section).

1. **No `INS_GET_PUBLIC_KEY` support exists.** Only signing
   (`INS_SIGN_TRANSACTION`, `0x04`) was ever researched or implemented
   (`docs/LEDGER_HEDERA_RESEARCH.md` doesn't mention the public-key
   instruction at all). Getting a `PublicKey` to pass to `signWith()`
   needs either new APDU-client code (undetermined effort — the
   instruction's existence in `LedgerHQ/app-hedera` hasn't even been
   confirmed the way `INS_SIGN_TRANSACTION` was) or a manual one-off
   workaround outside the package.

2. **The `hederaTransactionSigner` → `signWith()` → real Hedera network
   path has never been executed, in any test, in any environment.**
   Everything currently proven (the full 77-test broker property suite,
   this session's own empirical signature check) goes through
   `ledgerSign`/the dummy-transaction path, never through
   `hederaTransactionSigner` against a real `@hashgraph/sdk` `Transaction`
   or a real network. The type signatures line up (confirmed this
   session, see §2), but type-compatibility is not the same as "this
   actually verifies against Hedera consensus nodes."

3. **The 64-byte-raw-signature finding in §2 is new evidence from this
   session, not a previously-verified fact.** It should be treated as a
   promising signal that de-risks Design B/C, not as confirmation. A real
   spike (fund a testnet account with a Ledger-derived ECDSA key, submit
   one real signed transaction, confirm it settles) is the only way to
   actually close this out, and that spike has external dependencies
   (funded testnet credentials) this environment doesn't currently have.

4. **`hedera-transaction-body.ts`'s dummy-transaction approach is a load-bearing
   assumption for the *current* signer interface** (`submitPayment`'s
   `signer: (payload: string) => string | Promise<string>`). Both Design
   B and C need the real transaction body available *before* signing,
   which doesn't fit today's call order (sign happens as part of
   `RESERVED → SUBMITTED`, before `packages/settlement` ever builds
   anything) — this is a real sequencing/interface change, not just
   swapping which function gets called.

None of this blocks Design A, which is why it's the recommendation for the
remaining ~2 days.
