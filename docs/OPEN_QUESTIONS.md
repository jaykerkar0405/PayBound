# Open Questions

## Ledger signing curve mismatch (blocks task 3.1)

**Status:** Unresolved. Blocking.

`docs/TECH_STACK_ADR.md` specifies `@ledgerhq/hw-app-eth` for the Ledger
integration (`packages/ledger-signer`), which signs using secp256k1
(Ethereum-style signing). Hedera, however, natively uses the Ed25519 curve
for account keys and transaction signing.

This is a real mismatch, not just a naming detail: `hw-app-eth` cannot
produce Ed25519 signatures, and a Ledger device signs with whichever app
(Ethereum app vs. a curve-appropriate alternative) matches the target
curve. If the broker's signer is expected to produce signatures Hedera will
accept, the Ledger-side app/library chosen in task 3.1 needs to match
Hedera's curve, not necessarily `hw-app-eth`.

**Why this matters now, not just at task 3.1:** the Phase 1 stub signer
(tasks 1.5/1.6) needs to produce payment signatures in the same
shape/curve that the real Ledger-backed signer (task 3.1) will eventually
produce. If the curve is decided only when task 3.1 starts, the stub
signer and any code built against its output (state machine transitions,
`Broker.authorize` checks, property tests) may need to be reworked.

**What needs to happen:** whoever picks up Ledger research should confirm,
before 1.5/1.6 are implemented:
- Which curve/signature scheme the settlement path actually requires
  (this may depend on whether settlement is on Hedera directly, or via an
  EVM-compatible path such as Hedera's JSON-RPC relay, which would bring
  secp256k1 back into play).
- Which Ledger app and library support that curve (e.g. a Hedera-specific
  Ledger app, or a generic curve app, if `hw-app-eth` doesn't apply).

This question is intentionally left open here — no resolution is proposed,
only the conflict and its downstream impact.
