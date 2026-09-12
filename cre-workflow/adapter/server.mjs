#!/usr/bin/env node
/**
 * DEMO / LOCAL-DEV TOOLING ONLY — NOT A PRODUCTION COMPONENT.
 *
 * This is a local HTTP adapter that lets apps/broker/src/cre-policy.ts's
 * checkSpendPolicy() talk to the REAL, merged cre-workflow/spend-cap-workflow/
 * (PR #100) via a real `cre workflow simulate ... --http-payload` invocation
 * per request, instead of the non-functional `cre workflow simulate --listen`
 * debug harness (see docs/CHAINLINK_CRE_DESIGN.md "Local end-to-end wiring
 * (evaluated, not usable as-is)" for why --listen doesn't work as a
 * synchronous gateway: its HTTP response is always an empty 200 body, it
 * rate-limits to one execution per 30s, and its debug endpoint expects the
 * request wrapped as {"input": {...}}, not the raw {resourceId, exactAmount}
 * body the broker actually sends).
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE (stay inside these lines):
 *  - Does not modify, import, or duplicate any logic from
 *    cre-workflow/spend-cap-workflow/ (workflow.ts, main.ts) — PR #100's
 *    merged deliverable is untouched. This adapter only shells out to the
 *    real `cre` CLI against that unmodified workflow.
 *  - Does not modify apps/broker/src/cre-policy.ts, config.ts, issue.ts,
 *    issueCapability(), authorize(), or any invariant clause. Wiring this
 *    adapter up is just setting CRE_GATEWAY_URL to point at wherever this
 *    process is listening — a config value, not a code change.
 *  - Does not fabricate a result. If the `cre` CLI fails (auth, RPC, a
 *    compile error, anything), that failure is relayed back to the caller
 *    as-is, with the CLI's own real output attached — checkSpendPolicy()
 *    already fails open on a non-2xx/malformed response (cre-policy.ts
 *    lines 98-112), so an honest failure here degrades exactly the way the
 *    real production fail-open path is designed to.
 *
 * WHY THIS EXISTS: `cre workflow simulate` with `--http-payload` is a
 * one-shot CLI invocation, not a long-running server — there is no way to
 * point apps/broker's CRE_GATEWAY_URL directly at it. This process is the
 * thinnest possible bridge: receive an HTTP POST in the broker's exact wire
 * shape, invoke the CLI once per request with that payload forwarded
 * verbatim, and return whatever the CLI's own "Workflow Simulation Result"
 * line actually said.
 *
 * OPERATIONAL CHARACTERISTICS TO KNOW BEFORE USING THIS FOR ANYTHING BEYOND
 * a demo/manual round-trip check:
 *  - Latency: each request pays for a full `cre` CLI cold start — loading
 *    project settings, an RPC health check against project.yaml's
 *    (deliberately fake) chain entry, and compiling the workflow to WASM —
 *    before the trigger even runs. This is NOT a fast gateway. Do not point
 *    a real CRE_ENABLED=true broker at this for anything but a manual,
 *    supervised demo — it was never meant to survive concurrent or
 *    latency-sensitive traffic, and apps/broker's checkSpendPolicy() has no
 *    timeout on its own fetch() call (see the audit's Step 4 finding), so a
 *    slow or hung `cre` invocation here can hang a real /issue call.
 *  - Rate limiting: docs/CHAINLINK_CRE_DESIGN.md documents a 30-second
 *    rate limit specifically on `--listen`'s debug endpoint. This adapter
 *    deliberately never uses `--listen` for exactly that reason. Whether
 *    the CRE account/API applies any separate, account-wide rate limit to
 *    repeated one-shot `--http-payload` invocations could not be confirmed
 *    in this environment — the CLI is not authenticated here (see this
 *    adapter's evidence/ directory) — so treat that as genuinely unknown,
 *    not assumed clear.
 *  - Concurrency: requests are handled one at a time, deliberately (see
 *    ACTIVE_LOCK below) — spawning multiple concurrent `cre` CLI processes
 *    against the same project has not been tested and is not assumed safe.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, ".."); // cre-workflow/ — where project.yaml lives
const WORKFLOW_DIR_ARG = "spend-cap-workflow"; // relative to PROJECT_ROOT, per README.md
const TARGET = process.env.CRE_ADAPTER_TARGET ?? "staging-settings";
const PORT = Number(process.env.CRE_ADAPTER_PORT ?? 8090);
const CLI_TIMEOUT_MS = Number(process.env.CRE_ADAPTER_CLI_TIMEOUT_MS ?? 120_000);

/** Matches the CLI's real stdout shape (see evidence/simulation-output.txt from PR #100):
 *    ✓ Workflow Simulation Result:
 *    "{\"allowed\":true,\"reason\":\"CRE policy: allowed\"}"
 * The result line is itself a JSON-encoded STRING (the workflow handler
 * returns JSON.stringify(...), and the CLI prints that returned string
 * JSON-quoted) — so it needs to be JSON.parsed twice: once to unescape the
 * CLI's own quoting, once to parse the workflow's actual {allowed,reason}
 * object out of the resulting string. */
function extractResultFromCliOutput(stdout) {
  const marker = "Workflow Simulation Result:";
  const markerIndex = stdout.indexOf(marker);
  if (markerIndex === -1) return { ok: false, error: "no 'Workflow Simulation Result:' line in CLI output" };

  const afterMarker = stdout.slice(markerIndex + marker.length);
  const lines = afterMarker.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const resultLine = lines[0];
  if (resultLine === undefined) {
    return { ok: false, error: "'Workflow Simulation Result:' marker found but no following line" };
  }

  let asString;
  try {
    asString = JSON.parse(resultLine); // unescape the CLI's own quoting -> a string
  } catch (err) {
    return { ok: false, error: `could not JSON.parse the CLI's result line as a string: ${err.message}`, resultLine };
  }
  if (typeof asString !== "string") {
    return { ok: false, error: "CLI result line did not decode to a string", resultLine };
  }

  let parsed;
  try {
    parsed = JSON.parse(asString); // parse the workflow's own JSON.stringify(...) output
  } catch (err) {
    return { ok: false, error: `could not JSON.parse the workflow's inner result string: ${err.message}`, innerString: asString };
  }

  if (typeof parsed.allowed !== "boolean") {
    return { ok: false, error: "parsed result missing boolean 'allowed' field", parsed };
  }

  return { ok: true, result: parsed };
}

function runCreSimulate(resourceId, exactAmount) {
  return new Promise((resolve) => {
    const httpPayload = JSON.stringify({ resourceId, exactAmount });
    const args = [
      "workflow", "simulate", WORKFLOW_DIR_ARG,
      "--non-interactive",
      "--trigger-index", "0",
      "--http-payload", httpPayload,
      "--target", TARGET,
    ];

    const startedAt = Date.now();
    execFile(
      "cre",
      args,
      { cwd: PROJECT_ROOT, timeout: CLI_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        resolve({ error, stdout: stdout ?? "", stderr: stderr ?? "", durationMs, command: `cre ${args.join(" ")}` });
      },
    );
  });
}

// Deliberately serial — see this file's top comment ("Concurrency").
let busy = false;

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed", message: "POST only" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    if (busy) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "adapter_busy", message: "one cre CLI invocation is already in flight; this demo adapter is deliberately serial" }));
      return;
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json", message: "request body was not valid JSON" }));
      return;
    }

    const { resourceId, exactAmount } = parsedBody;
    if (typeof resourceId !== "string" || typeof exactAmount !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request", message: "expected { resourceId: string, exactAmount: string } — the exact shape checkSpendPolicy() sends" }));
      return;
    }

    busy = true;
    const cliRun = await runCreSimulate(resourceId, exactAmount).finally(() => { busy = false; });

    console.log(`[cre-adapter] ${cliRun.command} (${cliRun.durationMs}ms)`);

    if (cliRun.error) {
      // Relay honestly — do not fabricate {allowed:true}. checkSpendPolicy()
      // already fails open on any non-2xx response from its own gateway
      // caller, so a real 502 here degrades exactly the way production is
      // designed to when the CRE gateway is broken.
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "cre_cli_failed",
        message: cliRun.error.message,
        durationMs: cliRun.durationMs,
        stdout: cliRun.stdout,
        stderr: cliRun.stderr,
      }));
      return;
    }

    const extracted = extractResultFromCliOutput(cliRun.stdout);
    if (!extracted.ok) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "cre_output_unparseable",
        message: extracted.error,
        durationMs: cliRun.durationMs,
        stdout: cliRun.stdout,
        stderr: cliRun.stderr,
      }));
      return;
    }

    // Exactly the shape checkSpendPolicy() expects: { allowed: boolean, reason: string }.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(extracted.result));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[cre-adapter] listening on http://127.0.0.1:${PORT}`);
  console.log(`[cre-adapter] project root: ${PROJECT_ROOT}, target: ${TARGET}`);
  console.log(`[cre-adapter] point apps/broker/.env.local's CRE_GATEWAY_URL here to exercise a real round-trip.`);
});
