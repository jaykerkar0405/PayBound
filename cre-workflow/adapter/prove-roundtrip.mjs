#!/usr/bin/env node
/**
 * DEMO / LOCAL-DEV TOOLING ONLY — NOT A PRODUCTION COMPONENT.
 *
 * Exercises cre-workflow/adapter/server.mjs with an ALLOW and a DENY case,
 * using a byte-faithful mirror of apps/broker/src/cre-policy.ts's
 * checkSpendPolicy() request/response logic (verified line-by-line against
 * that file as it stands today — see the comment above each block below
 * pointing at the exact lines mirrored). This does not import or modify
 * cre-policy.ts; it exists only so this proof doesn't require wiring a full
 * broker instance up just to exercise one HTTP call's shape.
 *
 * Prints the real request sent and the real response received for each
 * case — nothing paraphrased or summarized.
 *
 * Usage: node prove-roundtrip.mjs [gatewayUrl]
 *   (defaults to http://127.0.0.1:8090, matching server.mjs's default port)
 */

const gatewayUrl = process.argv[2] ?? "http://127.0.0.1:8090";

/**
 * Mirrors apps/broker/src/cre-policy.ts's checkSpendPolicy() lines 91-128
 * EXACTLY: same method, same headers, same body shape, same response
 * parsing (response.ok check, then `typeof data.allowed !== "boolean"`
 * check), same fail-open-on-error behavior. The only difference from the
 * real function is that this one always treats CRE_ENABLED as true and
 * always has a gatewayUrl (gates 1-2 in the real function are about
 * whether to call the gateway at all — irrelevant here, since the whole
 * point of this script is to exercise the actual network call).
 */
async function checkSpendPolicyMirror(resourceId, exactAmount) {
  const requestBody = JSON.stringify({ resourceId, exactAmount });
  console.log(`\n--- REQUEST ---`);
  console.log(`POST ${gatewayUrl}`);
  console.log(`Content-Type: application/json`);
  console.log(requestBody);

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const rawText = await response.text();
    console.log(`\n--- RESPONSE ---`);
    console.log(`HTTP ${response.status}`);
    console.log(rawText);

    if (!response.ok) {
      console.log(`\n--- checkSpendPolicy() OUTCOME ---`);
      console.log(`(cre-policy.ts L98-103: non-2xx -> fail-open) { allowed: true, reason: "CRE gateway error: HTTP ${response.status}" }`);
      return;
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.log(`\n--- checkSpendPolicy() OUTCOME ---`);
      console.log(`(cre-policy.ts's response.json() would throw -> caught by the outer try/catch, L118-128: fail-open)`);
      return;
    }

    if (typeof data.allowed !== "boolean") {
      console.log(`\n--- checkSpendPolicy() OUTCOME ---`);
      console.log(`(cre-policy.ts L107-112: missing boolean 'allowed' -> fail-open) { allowed: true, reason: "CRE gateway response malformed — check skipped" }`);
      return;
    }

    const outcome = {
      allowed: data.allowed,
      reason: data.reason ?? (data.allowed ? "CRE policy: allowed" : "CRE policy: spend cap exceeded"),
    };
    console.log(`\n--- checkSpendPolicy() OUTCOME (cre-policy.ts L114-117) ---`);
    console.log(JSON.stringify(outcome));
  } catch (error) {
    console.log(`\n--- checkSpendPolicy() OUTCOME ---`);
    console.log(`(cre-policy.ts L118-128: fetch threw -> fail-open) { allowed: true, reason: "CRE gateway unreachable — check skipped: ${error.message}" }`);
  }
}

async function main() {
  console.log(`=== CASE 1: ALLOW (api-call-gpt4, 0.30 — under the 0.50 cap) ===`);
  await checkSpendPolicyMirror("api-call-gpt4", "0.30");

  console.log(`\n\n=== CASE 2: DENY (api-call-gpt4, 5.00 — over the 0.50 cap) ===`);
  await checkSpendPolicyMirror("api-call-gpt4", "5.00");
}

main();
