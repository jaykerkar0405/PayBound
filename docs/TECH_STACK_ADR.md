# ADR: Tech Stack (docs/TASKS.md task 0.5)

**Status:** Accepted
**Date:** 2026-09-06
**Depends on:** none (first ADR in the repo)
**Blocks:** all of Phase 1 onward in `docs/TASKS.md`

## Context

`docs/TASKS.md` task 0.5 requires deciding and documenting the tech stack per
component before any implementation work starts. This ADR records that
decision for all three workstreams (Broker/capability core, Sandbox/agent/
Ledger, Hedera-HCS/Chainlink CRE/demo) and is the basis for the scaffolded
Turborepo monorepo committed alongside it.

Before writing this, current official docs/registry listings were checked
(today's date: **2026-09-06**) for every tool below, rather than relying on
possibly-stale training knowledge, since package APIs and recommended project
layouts change. Sources checked: turborepo.dev (`create-turbo` reference),
npm registry listings for `@hono/zod-validator`, `zod`, `@hashgraph/sdk`,
`@ledgerhq/hw-app-eth`, the `ai` package, and `pnpm`; svelte.dev (`sv create`
CLI docs); docs.chain.link (CRE SDK reference and TypeScript runtime docs);
eslint.org (flat config migration guide); and nodesource.com / endoflife.date
for Node 24 LTS status. Exact resolved versions actually installed into this
repo are listed in the table below and are the ground truth — anywhere they
differ from what a reader might expect from older docs, trust this table.

## Decision

### Language/runtime — TypeScript (strict), Node.js 24 LTS

TypeScript strict mode across every workstream means the compiler enforces
the same tamper-proofing (readonly types, no implicit `any`) everywhere a
`Capability` or `Task` object is passed around, instead of only where a given
engineer remembers to opt in — that matters more here than in a typical
project because the core security claim ("the agent cannot construct a
payment") is partly a type-system claim. Node 24 was picked because it is the
current LTS line (codename Krypton, LTS since 2026-08-03, Maintenance LTS
starting 2026-10-20, EOL 2028-04-30) — new work should start on the LTS that
will still be supported well past the Sept 2026 deadline, not on a line about
to age out. One TypeScript/Node baseline for broker, sandbox, and demo also
means one CI matrix and one set of `tsconfig` conventions instead of three.

### Package manager — pnpm (workspaces)

pnpm's content-addressable store and strict `node_modules` symlink structure
catch a class of bug this project can't afford: a package silently resolving
an undeclared transitive dependency (npm/yarn's flat `node_modules` allow
this). For a codebase whose entire premise is "there is no undeclared path
from the agent to money," the same discipline should hold in the dependency
graph, not just the runtime one. pnpm workspaces + `pnpm-workspace.yaml` also
give first-class monorepo support that Turborepo is built to sit on top of.

### Monorepo tooling — Turborepo

Three workstreams (broker, sandbox/agent, settlement) with several shared
internal packages need incremental, cached builds so a change in
`packages/types` doesn't force a full rebuild of everything downstream every
time, and so each dev/session in `docs/TASKS.md` can run `turbo build` and
only pay for what actually changed. `create-turbo` is the official
scaffolding entry point (current version `create-turbo@2.10.12` per
turborepo.dev as of 2026-09-06); this repo's layout was hand-built to the
project's exact required folder names rather than accepting the tool's
default kitchen-sink example, but the resulting `turbo.json` follows
Turborepo's current v2 schema (`tasks`, not the deprecated v1 `pipeline` key).

### Broker service (`apps/broker`) — Hono + Zod (`@hono/zod-validator`) + better-sqlite3

Hono over Express: Hono is a small, standards-based (Fetch API) framework
with first-class TypeScript inference through its routing and validator
middleware, and no dependency on Node-specific APIs baked into the framework
itself — useful if the broker ever needs to run on an edge/isolate runtime
for latency or isolation reasons. Express's type story is bolted on via
`@types/express` and its middleware chain doesn't carry inferred types the
way Hono's `zValidator` does, which matters when every request into the
broker (the one place allowed to authorize a payment) should be schema-
validated with the validated, typed result available directly in the handler.
Zod is used both for that request validation and, later, as the runtime
counterpart to the `packages/types` definitions (see below). `better-sqlite3`
is a synchronous, embedded store appropriate for the resource registry and
budget tracker at this stage — it keeps the atomic nonce-burn-plus-budget-
check transaction in task 1.5 a single synchronous SQLite transaction with no
separate DB process to reason about, which is exactly what "atomic, no gap
between checking and consuming" requires. Revisit this if/when the broker
needs to run as more than one instance.

**Deployment scope note:** for this hackathon, the Broker runs as a single
process holding a single SQLite connection (`apps/broker/src/db.ts`) — a
deliberate scope decision, not a production deployment claim.
Multi-instance/horizontally-scaled deployment against a shared SQLite file
is explicitly out of scope. The `busy_timeout` pragma set on that
connection is cheap insurance against transient single-process contention
(e.g. WAL checkpointing, or multiple in-process callers), not multi-instance
support — a real multi-instance deployment would need a different storage
layer entirely, not just a longer timeout.

### Agent sandbox (`apps/sandbox`) — Docker + locked-down egress; Vercel AI SDK (`ai`)

Docker over a microVM (e.g. Firecracker) for this phase: Docker's network
namespace + iptables/egress-rule model is well-documented, fast to iterate
on, and sufficient to enforce and _demonstrate live_ (per the README's
explicit requirement) that every outbound path from the agent to payment
infrastructure is blocked except the one Broker channel. A microVM buys
stronger isolation at the kernel level, but that is a hardening step, not
what's needed to prove the network-boundary claim for the Sept 13 deadline;
it can be revisited post-submission without touching the capability/broker
contract. The Vercel AI SDK (`ai` package) was chosen over calling the
Anthropic SDK directly because the sandbox's payment tool must be exposed as
one of possibly several tool-call definitions in a standard tool-use loop,
and the AI SDK's tool-calling abstraction (`inputSchema`/`outputSchema`,
`generateText`/`streamText`, and its `Agent` wrapper as of the SDK's v5+
line) is provider-agnostic — the sandbox's attack-scenario tests (task 2.6-
2.8) shouldn't be coupled to one model vendor's raw API shape.

### Ledger integration (`packages/ledger-signer`) — `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-eth`

Ledger hardware signing means the broker's signing key is never a plaintext
file in the broker's own filesystem — the one thing standing between "the
broker approved this payment" and "the payment happened" requires physical
possession of (or an authenticated session with) the device. `hw-app-eth`
is the standard Ledger app-layer package for requesting an ECDSA signature
over the secp256k1 curve (the same curve/scheme used by Ethereum-style
accounts); this repo currently targets that scheme because it is the most
directly documented Ledger signing path, but **this is an open dependency,
not a settled fact** — see "Open Questions" below. `hw-transport-node-hid`
is the corresponding Node-side USB/HID transport; if the broker later runs
somewhere without native USB access (a server, not a workstation), this
transport choice will need revisiting in favor of Ledger's other transport
options.

### Hedera/HCS (`packages/settlement`) — `@hashgraph/sdk`, Hedera Testnet

Hedera and HCS are named directly in the project brief as the settlement and
audit-trail sponsor integration, so `@hashgraph/sdk` (the official JS/TS SDK)
is the direct choice rather than a community wrapper. Testnet (not Mainnet)
for all development and the Sept 13 demo, since this is pre-production and
no real value should move during development.

### Chainlink CRE (`packages/settlement`, feature-flagged) — `@chainlink/cre-sdk`

Confirmed via docs.chain.link (2026-09-06): the TypeScript SDK is
`@chainlink/cre-sdk`, and CRE workflows are TypeScript (or Go) compiled to
**WebAssembly** — they do not run in a normal Node.js process and cannot use
Node-only APIs or native bindings (`fs`, `path`, anything with native C++
bindings). That is a real constraint on how this module can be built, not
just an implementation detail: the CRE workflow code in
`packages/settlement` will need to be isolated from the rest of that
package's Node-targeted code (e.g. the Hedera client) rather than sharing a
single build target, and it's why this ADR calls the module "feature-
flagged/gated" — the README already states this integration must remain
optional and non-load-bearing for the core security guarantee, and the WASM
constraint is one more reason to keep it structurally separate. Because CRE
is explicitly called out as a very new product, this SDK's version and exact
`cre workflow simulate`/deploy steps should be re-verified against current
docs immediately before task 5.2 is implemented, not assumed from this ADR.

### Demo/dashboard (`apps/demo`) — SvelteKit

Scaffolded with the current official `sv create` CLI (from the `sv` package,
per svelte.dev docs as of 2026-09-06), `minimal` template, TypeScript, no
add-ons pre-selected (ESLint/Prettier are handled once at the monorepo root
instead of per-app, so they weren't added as an SvelteKit add-on to avoid a
second, conflicting config). SvelteKit was specified directly by the project
owner; it gives a fast dev loop for a demo dashboard that needs to render
live capability/payment-state updates during the Sept 13 walkthrough.

### Shared types (`packages/types`) vs. shared validation (`packages/capability-spec`)

These are deliberately two packages, not one, because they answer two
different questions that should be allowed to drift independently in how
they're checked: `packages/types` answers "what shape does a `Capability`
have, at compile time, everywhere it's imported" (enforced by `tsc`, zero
runtime cost, and directly supports the "tamper-proof by the type system"
requirement from task 0.3/1.3/1.5/1.6 via deep `readonly`/`Readonly<...>`
wrapping); `packages/capability-spec` answers "is this specific value I just
received over the wire actually a valid `Capability`, right now" (enforced
by Zod at runtime, at the actual trust boundary where untrusted or
external input first enters the broker). Collapsing them into one package
tends to produce exactly the anti-pattern this project is designed to avoid
elsewhere: a schema library's inferred type quietly becomes the source of
truth, and a change to validation logic can silently change the type
everywhere it's used, or vice versa. Keeping `packages/types` as the single
source of truth for shape, with `packages/capability-spec` re-exporting it
and asserting (via a compile-time `extends`-based check in the scaffold) that
its Zod-inferred type stays assignable to it, means the two can never
silently diverge without a build failure.

### Linting/formatting/testing — ESLint (flat config) + Prettier at root, Vitest

ESLint's flat config (`eslint.config.js`) is the current default/standard
format as of ESLint 9+ (the legacy `.eslintrc*` cascading-config format is
deprecated), confirmed against eslint.org's migration guide; `typescript-
eslint`'s flat-config helper (`tseslint.config(...)`) is used directly rather
than an older `parserOptions`/`extends` array. One root config (ESLint,
Prettier, Vitest) instead of one per package avoids drift between
workstreams' lint rules, which matters when three different people are
touching adjacent packages under a shared security invariant — a rule that's
enforced in `apps/broker` but silently absent in `packages/ledger-signer`
defeats the point. Vitest's `test.projects` array (not the deprecated
`vitest.workspace.*` file, removed as of Vitest's v3.2 deprecation /
scheduled v4 removal) points at every `apps/*`/`packages/*` workspace so
Phase 1's property tests (task 1.8) can run from the repo root or per-package
identically.

## Resolved versions (as actually installed, 2026-09-06)

| Package                   | Resolved version                                                                       | Where                                     |
| ------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `node` (verified against) | 24 LTS target; built/tested on locally-installed v26.7.0                               | root `engines.node: >=24`                 |
| `pnpm`                    | 11.3.0 (locally installed; `pnpm@latest` is 12.3.4 — not upgraded, see Open Questions) | `package.json#packageManager`             |
| `typescript`              | 6.0.3                                                                                  | root, `apps/demo`                         |
| `turbo`                   | 2.10.12                                                                                | root                                      |
| `eslint`                  | 10.10.0                                                                                | root                                      |
| `@eslint/js`              | 10.0.1                                                                                 | root                                      |
| `typescript-eslint`       | 8.69.0                                                                                 | root                                      |
| `prettier`                | 3.9.6                                                                                  | root                                      |
| `vitest`                  | 5.0.0                                                                                  | root                                      |
| `hono`                    | 4.13.7                                                                                 | `apps/broker`                             |
| `@hono/node-server`       | 2.1.1                                                                                  | `apps/broker`                             |
| `@hono/zod-validator`     | 0.9.1                                                                                  | `apps/broker`                             |
| `zod`                     | 4.5.4                                                                                  | `apps/broker`, `packages/capability-spec` |
| `better-sqlite3`          | 13.0.3                                                                                 | `apps/broker`                             |
| `tsx`                     | 4.23.13                                                                                | `apps/broker` (dev)                       |
| `@sveltejs/kit`           | 2.63.0                                                                                 | `apps/demo`                               |
| `svelte`                  | 5.56.1                                                                                 | `apps/demo`                               |
| `vite`                    | 8.0.16                                                                                 | `apps/demo`                               |
| `@sveltejs/adapter-auto`  | 7.0.1                                                                                  | `apps/demo`                               |

`@hashgraph/sdk` (2.81.0 per npm as of 2026-09-06), `@ledgerhq/hw-app-eth`
(7.8.16), `@ledgerhq/hw-transport-node-hid`, `ai` (7.0.92, i.e. past the v5
line referenced in the original brief), and `@chainlink/cre-sdk` are **not
yet installed** — `packages/ledger-signer`, `packages/settlement`, and
`apps/sandbox` are placeholders per the scaffolding scope, so these versions
are recorded here as the versions confirmed to exist today, to be pinned
when those packages gain real code in Phases 2-5.

## Open Questions / Flags

- **Ledger signing scheme (blocks tasks 1.5/1.6):** this ADR assumes ECDSA
  over secp256k1 via `@ledgerhq/hw-app-eth`, because that's the most directly
  documented Ledger JS signing path and matches an Ethereum-style account
  model. This has **not** been confirmed against the specific settlement
  chain(s)/account model the Broker will actually use once Hedera settlement
  (task 4.1) and any Ledger-side signing requirements are reconciled — Hedera
  natively uses Ed25519 (or ECDSA-secp256k1 as an alternative key type it
  also supports), so whoever picks up task 3.1 must confirm which curve the
  actual settlement path needs and pick the matching Ledger app (`hw-app-eth`
  for secp256k1, or a different Ledger app if Ed25519 is required) before
  writing the signer.
- **Chainlink CRE is very new**: `@chainlink/cre-sdk` exists on npm and
  docs.chain.link documents it as of 2026-09-06, but given how recently CRE
  shipped, re-check the SDK version, `cre workflow simulate` CLI steps, and
  the WASM runtime constraints immediately before task 5.1/5.2, not from this
  document.
- **pnpm 11.3.0 vs. 12.3.4:** the repo was scaffolded with the pnpm version
  already installed in this environment (11.3.0); pnpm 12 is now current and
  is a native executable (no longer requires Node to run pnpm itself once
  installed). Not upgraded here to avoid an unrequested tooling change;
  worth a deliberate upgrade decision before Phase 1 work starts in earnest.
- **`@types/node` resolved to `^26.4.1`**, tracking the Node version actually
  installed on this machine (v26.7.0), not Node 24. This is almost always
  harmless (Node's types are additive across majors), but if Phase 1/2 code
  ends up depending on a Node ≥26-only API surface by accident, it won't be
  caught by types alone — CI should pin and test against actual Node 24.
- **No breaking changes were hit** that required silently downgrading
  anything: TypeScript 6.x, ESLint 10.x, and Vitest 5.x are all newer major
  versions than the original brief's tooling assumptions likely anticipated
  (these tools were on TS 5.x/ESLint 9.x/Vitest 2-3.x in older training data);
  all three installed and built cleanly against this scaffold as-is, so they
  were kept rather than pinned back to older majors.
