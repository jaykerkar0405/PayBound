# ETHOnline 2026 — Build-From-Scratch (Net-New) Prize Tracks Only

> Source: ETHGlobal ETHOnline 2026 prizes page — https://ethglobal.com/events/ethonline2026/prizes
> Purpose: AI-ready reference filtered to only tracks open to **Net-New / Start Fresh** projects (built entirely during the hackathon). All tracks explicitly marked "🆕 This prize is only available to Continuity Track participants" have been removed.
> Note: A few sponsors run a single track that is open to *both* pools but judged together (no separate Continuity-only pool) — those are included as-is since a from-scratch project is fully eligible.

---

## Table of Contents
1. [The Graph — up to $10,000 eligible](#the-graph)
2. [Hedera — up to $14,000 eligible](#hedera)
3. [Arc — up to $6,834 eligible](#arc)
4. [World — up to $3,500 eligible](#world)
5. [1inch — up to $5,000 eligible](#1inch)
6. [ENS — up to $4,500 eligible](#ens)
7. [Uniswap Foundation — up to $3,000 eligible](#uniswap-foundation)
8. [Ledger — up to $3,500 eligible](#ledger)
9. [Privy — up to $5,000 eligible](#privy)
10. [Chainlink — up to $2,500 eligible](#chainlink)
11. [Bazantic — up to $2,000 eligible](#bazantic)

---

## The Graph
**Total pool:** $15,000 | **From-scratch eligible:** $10,000

### 🧩 Best Use of Composable or Standardized Graph Products — $5,000
| Place | Prize |
|---|---|
| 1st | $2,500 |
| 2nd | $1,500 |
| 3rd | $1,000 |

**Goal:** Build on composable/standardized data products — use Standardized Subgraphs (shared schema across a protocol type) for cross-protocol queries, compose reusable Substreams packages, or layer the Subgraph MCP on top for cross-protocol analysis. Contributing a new composable Substreams module for an emerging standard (e.g., ERC-4626 vault flows) also counts.

**Qualification Requirements:**
- Compose 2+ Graph products **OR** build meaningfully on a standardized schema (e.g., Messari Standardized Subgraphs).
- Must consume **live data** from a Graph provider (e.g., Subgraph Studio, The Graph Market). Mocked/local/static data does not qualify.
- Simply querying one Subgraph with no composition/standardization does NOT qualify.
- Authoring/extending a Standardized Subgraph or contributing a reusable composable Substreams module is in scope.
- Must clearly demonstrate the standards leverage (one query pattern across many protocols, or one pipeline reused across chains).
- Submit a public repo + 2–4 min demo video.

**Resources:**
- Messari Standardized Subgraph: https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/
- Agent0/ERC-8004 Subgraphs: https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/
- Standardized Substreams: https://github.com/streamingfast/substreams-chain-modules
- Pinax Primitives for EVM Substreams: https://github.com/pinax-network/substreams-evm

---

### 🤖 Best AI Tooling or AI Use Case with The Graph (From Scratch) — $5,000
| Place | Prize |
|---|---|
| 1st | $2,500 |
| 2nd | $1,500 |
| 3rd | $1,000 |

**Pool:** Net-new (Start Fresh) — projects begun and built during the hackathon. Open-source starter kits are fine; project-specific prior code is not.

**Description:** Rewards both (a) tooling that makes The Graph easier to use from AI environments (new/extended MCP servers, agent SKILLs, x402 payment tooling, A2A integrations, framework plugins, client configs) and (b) AI agents/apps that use The Graph as their live blockchain data source (research assistants, trading/execution agents, portfolio copilots, risk monitors, etc.).

- Query 15,000+ Subgraphs via Subgraph MCP in natural language, stream data with Substreams, or let agents autonomously pay per query via x402.
- **Featured Substreams challenge:** use Substreams SKILLs to go from a single natural-language prompt to a working, deployed Substreams pipeline.

**Qualification Requirements:**
- The Graph must be load-bearing: either AI tooling targets The Graph's products/AI Suite, or the agent/app uses The Graph (Subgraphs, Subgraph MCP, or Substreams) as its blockchain data source.
- Must consume **live data** from a Graph provider (e.g., Subgraph Studio API key, Substreams via The Graph Market). Mocked/local/static data does not qualify.
- Must do meaningful work with the data — reasoning, decisions, automation, or NL interface — not just printing raw query results. Tooling submissions must be reusable infrastructure, not a single end-user app.
- Open-source with clear README/SKILL.md; submit public repo + 2–4 min demo video.
- Follow the Start Fresh pool's ETHGlobal rules (net-new build during the hackathon).
- For the Substreams one-prompt challenge: demonstrate deploying a working Substreams pipeline from a single prompt using Substreams SKILLs.

**Resources:**
- Subgraph MCP: https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/
- Subgraph SKILLs: https://github.com/graphprotocol/subgraphs-skills
- Substreams SKILLs: https://github.com/streamingfast/substreams-skills

---

## Hedera
**Total pool:** $15,000 | **From-scratch eligible:** $14,000

### 🤖 AI & Agentic Payments on Hedera — $6,000
Up to 3 teams receive $2,000 each.

**Goal:** Stand up a real x402-gated service on Hedera and a platform that consumes it — agent discovers and pays for a service with no API key/subscription.

**Ideas:**
- Pay-per-call inference endpoint with a budgeting agent
- Metered data feed, priced/settled per query
- Agent marketplace (HBAR/HTS payments)
- Micropayment streaming for compute/bandwidth

**Qualification Requirements:**
- Host a live x402-gated service on Hedera testnet/mainnet, settled through the **Blocky402 facilitator**.
- Build a platform/agent consuming that service, completing at least one real paid request end-to-end.
- Public GitHub repo with README (setup, architecture, payment flow).
- Demo video ≤5 minutes showing the paid request executing.

**Extra points:** true per-call metering (not flat fee); multi-agent negotiation/settlement via A2A/ACP; on-chain agent identity (ERC-8004/HCS-14); agent discovery via UCP or directory; HTS tokens/custom fee schedules; verifiable audit trails on HCS; recurring/streamed payments via Scheduled Transactions.

**Resources:**
- Hedera Code Snippets: https://github.com/hedera-dev/hedera-code-snippets
- Hedera Discord: https://hedera.com/discord
- Hedera & x402 blog: https://hedera.com/blog/hedera-and-the-x402-payment-standard/
- Blocky402 facilitator: https://blocky402.com/
- x402 pay-per-request PoC: https://github.com/hedera-dev/x402-inference-pay-per-request-poc
- Hedera Agent Kit: https://github.com/hashgraph/hedera-agent-kit-js
- Hedera developer docs: https://docs.hedera.com/
- Starter template: https://github.com/hedera-dev/scaffold-hbar
- x402 Protocol: https://github.com/x402-foundation/x402

---

### 🛠️ Open Source — Improve the Hedera Harness — $2,000
Up to 2 teams receive $1,000 each.

**Goal:** Improve the Hedera Harness (primary developer tool layer) or build a new harness on its foundations.

**Ideas:** extend thin service coverage; port to another language/runtime; fix first-hour rough edges; add testing/local-dev mode to avoid testnet round trips.

**Qualification Requirements:**
- Submit a meaningful contribution to the Hedera Harness (open PR, need not be merged) **or** build a new harness extending/inspired by it.
- Public GitHub repo or PR link with README/PR description (problem solved, how to run).
- Demo video ≤5 minutes showing the improvement.

**Extra points:** new service coverage, better ergonomics, fewer lines to a working transaction; tests/docs/examples; harness targeting an uncovered language/framework; clear before/after DX evidence.

**Resources:**
- Hedera Harness: https://github.com/hedera-dev/hedera-harness
- Hedera Skills: https://github.com/hedera-dev/hedera-skills
- Getting started with SDKs: https://docs.hedera.com/hedera/getting-started-sdk-developers
- Developer tooling overview: https://hedera.com/developer-tooling/
- Code snippets: https://github.com/hedera-dev/hedera-code-snippets
- Discord: https://hedera.com/discord

---

### 🪙 Tokenization of Anything — $6,000
Up to 3 teams receive $2,000 each.

**Goal:** Build an enterprise finance app on Hedera using the **Asset Tokenization Studio (ATS)**. ATS supports ERC-3643 + ERC-1400 with compliance controls, corporate actions, coupon handling built in.

**Ideas:** tokenized collateral for repo; bonds with full lifecycle (issuance/coupons/redemption); secondary market for ATS assets; tokenized equities with KYC-gated register; cashflow tokenization (invoices/receivables/royalties).

**Qualification Requirements:**
- Use ATS (SDK, contracts, web app, or combination) to issue/manage a tokenized asset.
- Deploy and demonstrate on **Hedera testnet**.
- Public GitHub repo; contracts verified on HashScan where applicable.
- Demo video ≤5 minutes showing issuance, configuration, and ≥1 lifecycle operation (transfer, compliance check, or distribution).

**Extra points:** secondary market for ATS assets (not in Studio today); compliance controls in use (KYC, freezes, transfer restrictions, pauses); custom fee schedules/coupon/dividend/royalty flows; oracle integration for pricing/NAV; Scheduled Transactions for vesting/coupons/maturity; upstream contributions to ATS.

**Resources:**
- ATS monorepo: https://github.com/hashgraph/asset-tokenization-studio
- ATS SDK (npm): https://www.npmjs.com/package/@hashgraph/asset-tokenization-sdk
- Starter template: https://github.com/hedera-dev/scaffold-hbar
- Discord: https://hedera.com/discord
- Developer tooling: https://hedera.com/developer-tooling/
- Developer docs: https://docs.hedera.com/
- ATS product overview: https://hedera.com/product/asset-tokenization-studio/
- ATS documentation: https://docs.hedera.com/hedera/open-source-solutions/asset-tokenization-studio-ats

---

## Arc
**Total pool:** $10,000 | **From-scratch eligible:** $6,834

### 🏆 Best DeFi/Onchain Finance Application — $1,667
**Goal:** Build stablecoin-native DeFi on Arc — lending, borrowing, swaps, liquidity, FX, yield, payments, treasury, or fintech infrastructure using Arc + USDC.

**Looking for:** meaningful Arc+USDC use; advanced programmable money flows (conditional payments, automation, multi-step settlement); payment/liquidity/treasury workflows using App Kits; a clear case for why stablecoin-native infra changes what's possible.

**Qualification Requirements:**
- State clearly which bounty you're submitting for.
- Functional MVP + architecture diagram (working frontend + backend).
- Video demo + presentation of core functions and use of Circle dev tools, with documentation.
- Link to GitHub/Replit repo.

---

### 🏆 Best Agentic Economy Application with Circle Agent Stack — $1,667
**Goal:** Build autonomous agents that transact on Arc — hold wallets, make payments, manage risk, settle jobs, or transact with other agents using USDC.

**Looking for:** agents with clear decision logic tied to real signals; autonomous spend/payment/settlement flows using USDC; use of Agent Stack to connect agents to wallets/USDC/onchain actions; use of Nanopayments/Paymaster/App Kits for agent-to-agent or service payments.

**Qualification Requirements:** functional MVP + architecture diagram; video demo + presentation with documentation; link to GitHub/Replit repo; state clearly which bounty you're submitting for.

---

### 🏆 Launch on Arc Testnet & Push to Mainnet — $3,500
| Place | Prize |
|---|---|
| 1st | $2,500 |
| 2nd | $1,000 |

**Goal:** Add a working Arc integration to a project that's ready to ship to mainnet (not just a prototype).

**Looking for:** USDC/EURC payment flows added to commerce/fintech/wallet products; crosschain transfers/unified balance with Arc as settlement layer; agentic payments shipped into an AI agent/API monetization tool; stablecoin settlement/escrow logic added to a DeFi protocol/marketplace; Arc-powered treasury/FX features in a multi-chain product.

**Qualification Requirements:**
- State clearly which track you're submitting for.
- Functional MVP + architecture diagram.
- Video demo + presentation of core functions/dev tool usage, with documentation.
- Link to GitHub/Replit repo.
- **Projects must be deployed or deployment-ready on Arc mainnet by September 30.**

**Resources (all Arc tracks):**
- Arc Docs: https://docs.arc.io/
- App Kits: https://docs.arc.io/app-kit
- Circle Dev Docs: https://developers.circle.com/
- Agent Stack Starter Kit: https://github.com/circlefin/agent-stack-starter-kits

---

## World
**Total pool:** $7,000 | **From-scratch eligible:** $3,500

### 🤳🏼 Selfie Check — $3,500
Up to 3 teams receive $1,166 each.

**Goal:** Build and demo a realistic Selfie Check flow validating where a low-friction, low-assurance biometric credential is useful for risk, eligibility, fairness, continuity, or abuse prevention.

**Qualification Requirements:**
- Uses Selfie Check or a Selfie Check-compatible World ID credential flow meaningfully.
- Treats Selfie Check as a risk/eligibility/fairness/continuity/abuse-prevention signal.
- Includes a feedback document covering: SelfieCheck docs/integration flow; Developer Portal navigation/search/discovery/debugging; Sandbox App states/proof flows/test users/errors/edge cases; what was confusing/missing/broken/hard to test.
- Shows a working app.

**Resources:**
- Selfie Check: https://docs.world.org/world-id/credentials/11
- Selfie Check Sandbox Testing: https://docs.world.org/world-id/sandbox/testing-selfie-check
- Selfie Check (Beta): https://docs.world.org/world-id/idkit/credentials#selfie-check-beta
- World Developer Portal: https://developer.world.org
- World Docs: https://docs.world.org/
- Sandbox Access request form: https://forms.gle/mqbaiwMvX5MzmKdY8

---

## 1inch
**Total pool:** $7,000 | **From-scratch eligible:** $5,000

### 💧 Build an Aqua App — $5,000
| Place | Prize |
|---|---|
| 1st | $2,500 |
| 2nd | $1,500 |
| 3rd | $1,000 |

**Goal:** Create a custom Aqua app implementing a sophisticated DeFi position. If using **SwapVM**, you may modify opcodes and define custom instructions. Projects using SwapVM score higher.

**Qualification Requirements:**
- Must use official Aqua/SwapVM contracts (redeployment of a modified SwapVM contract is allowed).
- Onchain execution of token transfers demonstrated at final demo (local forks OK).
- Proper Git commit history (no single-commit entries on the final day).

**Resources:**
- SwapVM Smart Contracts: https://github.com/1inch/swap-vm/tree/main
- Aqua Smart Contracts: https://github.com/1inch/aqua
- Aqua SDK: https://github.com/1inch/sdks/tree/master/typescript/aqua
- SwapVM Whitepaper: https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf
- Aqua Whitepaper: https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf

---

## ENS
**Total pool:** $5,000 | **From-scratch eligible:** $4,500

### 🧬 Best Use of ENSv2 — $4,500
| Place | Prize |
|---|---|
| 1st | $1,500 |
| 2nd | $1,500 |
| 3rd | $1,000 |
| Runner-Up | $500 |

**Goal:** ENSv2 beta is live on Sepolia. Explore the new hierarchical registry structure — resolve subnames off a parent's resolver via wildcard resolution, or deploy your own subname registry to tokenize/manage subnames under your own rules. Use **Enhanced Access Control** (shared role-based permission system for registries/resolvers) to delegate specific rights. Give subnames their own **Permissioned Resolver**; mix record aliasing (resolver-level) with namespace aliasing (shared registry). Build subname setups: expiring, revocable, non-transferable vs. transferable, even forever names with no parent control. Bonus for bringing AI agents in (agents as namespaces with own identity/permissions).

**Qualification Requirements:**
- Must be built on **ENSv2 (Sepolia)**; ENSv2 features must be central, not cosmetic.
- Demo must be functional, not hard-coded values.
- Video recording or live demo link (ideally both); open-source code on GitHub or similar.

**Resources:**
- Permissioned Registry docs: https://docs.ens.domains/ensv2/permissioned-registry
- Permissioned Resolver docs: https://docs.ens.domains/ensv2/permissioned-resolver
- Enhanced Access Control docs: https://docs.ens.domains/ensv2/enhanced-access-control
- Guide for Contract Developers: https://docs.ens.domains/ensv2/tutorial-contract-developers
- ENSv2 Docs: https://docs.ens.domains/ensv2/overview
- Building with AI: https://docs.ens.domains/building-with-ai/
- Agent-native CLI: https://github.com/ensdomains/ens-cli
- AI Agent Registry ENS Name Verification (ENSIP-25): https://docs.ens.domains/ensip/25/
- Agent Text Records (ENSIP-26): https://docs.ens.domains/ensip/26/

---

## Uniswap Foundation
**Total pool:** $5,000 | **From-scratch eligible:** $3,000

### 🦄 Best Uniswap Stack Contribution — $3,000
Up to 3 teams receive $1,000 each.

**Goal:** Build on or integrate any part of the Uniswap stack — Uniswap API, AMM (v2/v3/v4), CCA, or any other Uniswap protocol. Includes new v4 hooks, extensions/improvements to official Uniswap repos, and ecosystem tooling.

**Qualification Requirements:**
- Public GitHub repo with open-source code.
- A `FEEDBACK.md` file.
- Completed submission to the Uniswap Developer Feedback Form (https://developers.uniswap.org/hackathon-feedback) including a link to your `FEEDBACK.md`.
- Submissions without feedback form completion will be reviewed/audited before winners are finalized.
- README must clearly point to relevant contracts and lines of code for verification.

**Resources:**
- Uniswap Docs: https://developers.uniswap.org/docs
- Uniswap Developer Platform: https://developers.uniswap.org/dashboard
- Uniswap Developer Support: https://developers.uniswap.org/docs?form=help
- Uniswap Hackathon Feedback form: https://developers.uniswap.org/hackathon-feedback
- Uniswap AI: https://github.com/Uniswap/uniswap-ai

---

## Ledger
**Total pool:** $5,000 | **From-scratch eligible:** $3,500

### 🤖 AI Agents x Ledger — $3,500
| Place | Prize |
|---|---|
| 1st | $2,000 |
| 2nd | $1,000 |
| 3rd | $500 |

**Goal:** Start something **new** during the event where device-backed security is central — agents that hold secrets they cannot leak, agents that pay for what they use, systems requiring human approval before irreversible actions, products making autonomous behavior safer (not bypassing user intent).

**What they most want to see:**
- Agents using secrets they cannot leak — a broker hands out scoped capabilities, never the raw API key.
- Bringing the **Key Ring** to hosts with no USB port — enroll a VPS, CI runner, or hosted agent.
- (Both of the above must be built on the **Ledger Agent Stack**, specifically the **Ledger Key Ring CLI** `wallet-cli ring`.)
- Agents paying for APIs/tools/services via Ledger-secured payment flows, including x402-style patterns.
- Human-in-the-loop agents where Ledger approves high-risk actions before funds move or permissions escalate.

**Resources:**
- Track details: https://developers.ledger.com/ethonline

---

## Privy
**Total pool:** $5,000 | **From-scratch eligible:** $5,000 (no Continuity split for this sponsor)

### 🏢 Best B2B financial product — $2,500

**Goal:** Build a product helping businesses manage digital assets/financial operations with Privy — treasury platforms, business accounts, payroll, spend management, payment ops, shared org wallets.

**Strong submissions use:** organization wallets, policies, team permissions, quorum approvals, intents, automated transactions, event-driven operations.

**Qualification Requirements:**
- Integrate Privy as a core part of the product.
- Create/use at least one Privy wallet.
- Demonstrate a business/organization use case.
- Implement ≥1 functional B2B workflow (payment, approval, treasury operation, or wallet administration flow).
- Use at least one Privy control (policies, signers, key quorums, or intents).
- Provide a working demo and access to source code.
- Clearly explain how Privy enables the product.

---

### 💸 Best financial flow — $2,500

**Goal:** Build a seamless experience for funding, moving, trading, growing, or spending digital assets with Privy — payments, remittances, cross-chain transfers, stablecoin conversions, swaps, savings, payouts, card-like spending.

**Strong submissions use:** Privy wallet actions or funding tools to simplify a real financial flow and hide unnecessary onchain complexity.

**Qualification Requirements:**
- Integrate Privy as a core part of the product.
- Create/use at least one Privy wallet.
- Complete ≥1 functional financial flow using a **generally available** Privy feature (transfers, bridging, stablecoin conversions, swaps, self-service Earn vaults, onramps, or other supported wallet actions).
- Provide a working demo and access to source code.
- Clearly explain how Privy improves the UX.
- Features requiring commercial/guided onboarding may be mocked but do NOT count as the required functional Privy integration.
- **Note:** Privy Cards currently requires guided Privy + Bridge onboarding — a mocked card experience is allowed but another live Privy flow is required for eligibility.

**Resources (both tracks):**
- Privy documentation: https://docs.privy.io/
- Privy quickstart: https://docs.privy.io/basics/get-started/quickstart
- Privy GitHub: https://github.com/privy-io

---

## Chainlink
**Total pool:** $3,000 | **From-scratch eligible:** $2,500

### 🔗 Best Confidential Workflow — $2,000
Up to 2 teams receive $1,000 each.

**Goal:** Build a privacy-preserving Web3 app with **Chainlink Runtime Environment (CRE) Confidential Workflows**, which execute sensitive workflow parts inside a hardware-isolated TEE. Secrets are fetched inside the enclave; sensitive inputs/API responses/intermediate computation stay protected. Developer controls what leaves the enclave (for DON consensus, external delivery, or onchain settlement).

**Example use cases:** AI smart-contract audit firewalls protecting API creds/eval criteria/model responses; automated liquidation protection with private risk thresholds; confidential portfolio rebalancing; automated trading on proprietary strategy data; privacy-preserving risk assessment/policy enforcement; confidential computation over financial/identity/healthcare/compliance data; secure LLM/agent workflows on private inputs; automated payment orchestration with protected account/routing details; privacy-preserving access to authenticated Web2 APIs.

**Qualification Requirements:**
- Build a CRE Workflow using Confidential Workflows for a meaningful part of the app.
- Workflow must register/use a confidential TEE handler (`handlerInTee` in TypeScript or `cre.HandlerInTee` in Go).
- Confidential portion must process ≥1 sensitive input/secret/confidential API response/private parameter/intermediate value inside the enclave.
- Confidential Workflow must be meaningfully integrated into the app's core functionality — a placeholder handler or isolated example doesn't count.
- Demonstrate successful execution via a Confidential Workflow simulation (CRE CLI) or a live CRE network deployment, with evidence (demo video, terminal output, execution logs, or deployment details).

**Resources:**
- AI Smart Contract Audit Firewall Template: https://docs.chain.link/cre-templates/ai-audit-firewall
- Automated Liquidation Protection Template: https://docs.chain.link/cre-templates/automated-liquidation-protection
- Hello Confidential Workflow: https://docs.chain.link/cre-templates/hello-confidential-workflows
- CRE Docs: https://docs.chain.link/cre
- Confidential Workflows Starter Templates: https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/confidential-workflows
- Confidential Workflows Bootcamp video: https://www.youtube.com/watch?v=ArHoB1JDSlE

---

### 🔒 Automated Liquidation Protection Challenge — $500

**Goal:** Build a Confidential Workflow protecting a virtual ETH-collateral/USDC-debt position during simulated market movements.

**The workflow must:**
- Avoid liquidation.
- Preserve the benefit of keeping the loan open.
- Use emergency capital efficiently.
- Keep sensitive protection rules and credentials private.

**Qualification Requirements:**
- Join the official challenge via the Sepolia smart contract before the submission deadline: `0x59d5B29FbA5ca865a171076BE94EbEeC5BCA1E04`, calling `join()`, between **Sept 8** and the hackathon submission deadline.
- After the deadline, the Chainlink team runs scenarios over the next 24h to determine the winner.
- **No workflow updates allowed after the submission deadline.**

**Resources:**
- Challenge Smart Contract (Sepolia Etherscan): https://sepolia.etherscan.io/address/0x59d5B29FbA5ca865a171076BE94EbEeC5BCA1E04
- Virtual ETH token: https://sepolia.etherscan.io/address/0x89F0DF6D4629D494D599E03505C323537C24667a
- Virtual USD token: https://sepolia.etherscan.io/address/0xC96c007023Ae2a23D097D5D95d4b91D6a501Da0b
- Challenge Repo: https://github.com/solangegueiros/cf-liquidation-protection-challenge

---

## Bazantic
**Total pool:** $3,000 | **From-scratch eligible:** $2,000

### 🍳 Best Recipe that uses ETHGlobal Hackathon Sponsor APIs — $1,000
| Place | Prize |
|---|---|
| 1st | $500 |
| 2nd | $300 |
| 3rd | $200 |

**Goal:** Create a Recipe that chains multiple APIs your project uses into one repeatable workflow that moves from one service to the next, accomplishing something neither could solve alone.

**Example:** integrate Uniswap API + 1inch Trace API — a Recipe where Uniswap's `GET /swap` result feeds into 1inch Trace's `GET /transaction trace by block number and transaction hash`.

**Qualification Requirements:**
- Create an account on bazantic.com.
- Create an x402/MPP Gateway in Bazantic for your project.
- Use ≥1 other service already available through Bazantic **OR** available from an ETHGlobal Online Hackathon sponsor.
- Create a Recipe using both services in one working flow.
- Final result must depend meaningfully on both services.
- Demonstrate the completed task start-to-finish in a screen recording.
- Provide Bazantic account username for attribution.

---

### 👨‍🍳 Agentify a new API — $1,000
| Place | Prize |
|---|---|
| 1st | $500 |
| 2nd | $300 |
| 3rd | $200 |

**Goal:** Bring a useful **new** API service into Bazantic, connect it with your hackathon project, and demonstrate something agents couldn't previously do. Best submissions add a reusable API service/Recipe for other builders, not a one-off demo connection.

**Example:** integrate a financial-data API (not yet on Bazantic) for coffee futures prices, compare against wholesale importer data, and build a coffee-purchase deal tracker/alert system.

**Qualification Requirements:**
- Create an account on bazantic.com.
- Create an x402/MPP Gateway in Bazantic for your project.
- Add a service NOT already available through Bazantic AND not an API available via other sponsors when the event began.
- Create a working Gateway for that service on Bazantic.
- Create a Recipe using both services in one working flow within your hackathon project.
- Explain how other builders/agents could use the new service via a screen recording.
- Provide Bazantic account username for attribution.

---

## Excluded Tracks (Continuity-Only — Not Eligible for From-Scratch Projects)

For reference, the following tracks were filtered OUT of this file because they are explicitly restricted to Continuity Track participants (projects extending prior work):

- The Graph — Best AI Tooling or AI Use Case with The Graph (Continuity pool)
- Hedera — Continuity ($1,000)
- Arc — Best DeFi or Agentic Application ($1,666, Continuity)
- Arc — Launch on Arc Testnet & Push to Mainnet (Continuity, $1,500)
- World — AgentKit Continuity ($3,500)
- 1inch — Build an Aqua App - Continuity Track ($2,000)
- ENS — Best Integration of ENSv2 into an Existing Project ($500, Continuity)
- Uniswap Foundation — Best Uniswap Stack Contribution (Continuity, $2,000)
- Ledger — Continuity ($1,500)
- Chainlink — Best Chainlink-Powered Upgrade ($500, Continuity)
- Bazantic — Help an Agent Use Your Hackathon Project ($1,000, Continuity)

---

## Grand Total — From-Scratch Eligible Prize Pool

**$52,834** across all sponsors listed above (out of $85,000 total sponsor pool shown on the ETHOnline 2026 prizes page).

---

## How to Use This File (for AI Agents)

1. This file only contains tracks a **brand-new, hackathon-built project** can enter — no prior code, no existing product extension.
2. Check the **Qualification Requirements** literally — many require live data (no mocks), specific contract addresses, specific handler function names, video length limits, or specific files (e.g., `FEEDBACK.md`).
3. Cross-reference the **Resources** links for docs/starter templates/SDKs before recommending an implementation approach.
4. Note key dates: Arc mainnet-ready by **September 30**; Chainlink liquidation challenge `join()` window opens **September 8**.
5. Some sponsors (The Graph's AI track) explicitly split into two internally-judged pools even within a "single" track — always confirm you're following the **Start Fresh / Net-New** pool's specific rules where both pools exist under one prize name.
