# PayBound Spend-Cap Confidential Workflow

Real Chainlink CRE Confidential Workflow implementation for Issue #98 (5.3),
replacing the conceptual/stubbed CRE job that the broker's
`checkSpendPolicy()` previously assumed. This directory is isolated from the
rest of the monorepo's Node-targeted build pipeline because CRE workflows
compile to WASM — see `docs/TECH_STACK_ADR.md` (L139-155) for the rationale.

**Status:** scaffold only. The workflow logic is not implemented yet
(Phase 2); this README will be filled in with confirmed working commands
once Phase 3 verifies the simulation.

## Structure

```
cre-workflow/
├── spend-cap-workflow/   # the workflow package (compiles to WASM)
├── secrets.yaml          # maps SPEND_CAPS -> SPEND_CAPS_JSON env var
├── .env.example          # local-only secret template (never commit real .env)
├── project.yaml          # CRE project settings (RPCs, placeholder values)
└── evidence/             # simulation output captured in Phase 3
```

## Setup

TODO (Phase 3): confirm and document the exact steps once verified, e.g.:

```bash
cd cre-workflow/spend-cap-workflow
bun install
cd ..
cp .env.example .env
# fill in SPEND_CAPS_JSON in .env for local simulation only
```

## Simulate

TODO (Phase 3): confirm and document the exact simulate command once
verified, e.g.:

```bash
cre workflow simulate spend-cap-workflow --target staging-settings --non-interactive
```

## Notes

- This workflow is additive and non-load-bearing: it does not modify
  `apps/broker/src/cre-policy.ts`, `issueCapability()`, `authorize()`, or any
  broker-side invariant checks.
- Secrets (`SPEND_CAPS_JSON`) are only ever decrypted inside the enclave —
  never visible to the broker or logged in plaintext.
