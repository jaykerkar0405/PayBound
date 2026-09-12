# PayBound Spend-Cap Confidential Workflow

Real Chainlink CRE Confidential Workflow implementation for Issue #98 (5.3),
replacing the conceptual/stubbed CRE job that the broker's
`checkSpendPolicy()` previously assumed. This directory is isolated from the
rest of the monorepo's Node-targeted build pipeline because CRE workflows
compile to WASM — see `docs/TECH_STACK_ADR.md` (L139-155) for the rationale.

**Status:** implemented and verified via `cre workflow simulate` against
`staging-settings` — see `evidence/simulation-output.txt` for real,
unedited terminal output covering the allow/deny/fallback decision tree.

## Structure

```
cre-workflow/
├── spend-cap-workflow/
│   ├── main.ts             # thin entrypoint: Runner.newRunner + runner.run
│   ├── workflow.ts         # onHttpTrigger, initWorkflow, configSchema
│   ├── main.test.ts        # unit tests (fake TeeRuntime, no CRE WASM host needed)
│   ├── config.staging.json # {} — no workflow-level config; caps come from the secret
│   ├── workflow.yaml       # staging-settings target (workflow-name, artifact paths)
│   ├── package.json
│   ├── tsconfig.json
│   └── bun.lock
├── secrets.yaml            # maps SPEND_CAPS -> SPEND_CAPS_JSON env var
├── .env.example            # local-only secret template (never commit real .env)
├── project.yaml            # CRE project settings (RPCs, placeholder values)
└── evidence/
    └── simulation-output.txt  # real cre workflow simulate output (Phase 3)
```

## Setup

```bash
cd cre-workflow/spend-cap-workflow
bun install

cd ..
cp .env.example .env
# .env.example's example caps (api-call-gpt4: 0.50, api-call-claude: 1.00,
# default: 0.25) are sufficient for local simulation as-is.
```

Prerequisites (verified in Phase 0/3 — see `evidence/simulation-output.txt`):

```bash
cre version    # CRE CLI version v1.33.0
cre whoami     # confirm you're logged in; run `cre login` if not
               # (the real top-level command, confirmed via `cre --help` —
               # not `cre auth login`)
```

## Simulate

Run from `cre-workflow/` (the project root, where `project.yaml` lives) —
`cre workflow simulate <workflow-folder-path>` takes the workflow's folder
as a relative path argument, not a cwd inside it:

```bash
cd cre-workflow

# ALLOW — under the api-call-gpt4 cap (0.50)
cre workflow simulate spend-cap-workflow --non-interactive --trigger-index 0 \
  --http-payload '{"resourceId": "api-call-gpt4", "exactAmount": "0.30"}' \
  --target staging-settings
# → "{\"allowed\":true,\"reason\":\"CRE policy: allowed\"}"

# DENY — over the api-call-gpt4 cap
cre workflow simulate spend-cap-workflow --non-interactive --trigger-index 0 \
  --http-payload '{"resourceId": "api-call-gpt4", "exactAmount": "5.00"}' \
  --target staging-settings
# → "{\"allowed\":false,\"reason\":\"CRE policy: spend cap exceeded (requested 5.00, cap 0.50)\"}"

# FALLBACK-DEFAULT — unknown resourceId, falls back to the "default" cap (0.25)
cre workflow simulate spend-cap-workflow --non-interactive --trigger-index 0 \
  --http-payload '{"resourceId": "totally-unknown-resource", "exactAmount": "0.30"}' \
  --target staging-settings
# → "{\"allowed\":false,\"reason\":\"CRE policy: spend cap exceeded (requested 0.30, cap 0.25)\"}"
```

`--trigger-index 0` is the only registered trigger (confirmed: passing an
out-of-range index reports `available range: 0-0`).

A fourth case — **FALLBACK-PERMISSIVE**, where neither the resourceId nor a
`"default"` key exists in the caps table — is documented in
`evidence/simulation-output.txt`. It requires temporarily removing the
`"default"` key from `.env`'s `SPEND_CAPS_JSON`; restore `.env.example`'s
original content immediately afterward if you reproduce it.

### Running the unit tests

```bash
cd cre-workflow/spend-cap-workflow
bun run typecheck
bun test
```

## Wire format

`onHttpTrigger` matches the exact shape `apps/broker/src/cre-policy.ts`
sends and expects:

- **Request** (broker → workflow): `{ "resourceId": string, "exactAmount": string }`
- **Response** (workflow → broker): `{ "allowed": boolean, "reason": string }`

## Notes

- This workflow is additive and non-load-bearing: it does not modify
  `apps/broker/src/cre-policy.ts`, `issueCapability()`, `authorize()`, or any
  broker-side invariant checks.
- Secrets (`SPEND_CAPS_JSON`) are only ever decrypted inside the enclave via
  `runtime.getSecret()` — never visible to the broker, and never logged
  (only the resolved allow/deny decision is logged, not the caps table).
- Registers via `cre.handlerInTee`, not `cre.handler` — the confidential
  workflow prize's literal requirement.
