#!/usr/bin/env node
/**
 * DEMO / LOCAL-DEV TOOLING ONLY.
 *
 * The CRE CLI is not authenticated in this environment (see
 * evidence/roundtrip-attempt.txt), so server.mjs's extractResultFromCliOutput()
 * cannot be exercised against a live successful `cre workflow simulate` run
 * today. This instead re-runs that exact same parsing function against the
 * REAL, previously-captured CLI stdout in
 * ../evidence/simulation-output.txt (PR #100's own evidence, unedited) —
 * proving the parser is correct against real CLI output, even though a
 * fresh live run isn't currently possible.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const evidencePath = path.resolve(HERE, "../evidence/simulation-output.txt");
const fullLog = readFileSync(evidencePath, "utf-8");

// Copied verbatim from server.mjs — see that file for the doc comment
// explaining the double-JSON-decode.
function extractResultFromCliOutput(stdout) {
  const marker = "Workflow Simulation Result:";
  const markerIndex = stdout.indexOf(marker);
  if (markerIndex === -1) return { ok: false, error: "no 'Workflow Simulation Result:' line in CLI output" };
  const afterMarker = stdout.slice(markerIndex + marker.length);
  const lines = afterMarker.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const resultLine = lines[0];
  if (resultLine === undefined) return { ok: false, error: "no following line" };
  let asString;
  try { asString = JSON.parse(resultLine); } catch (err) { return { ok: false, error: err.message }; }
  if (typeof asString !== "string") return { ok: false, error: "not a string" };
  let parsed;
  try { parsed = JSON.parse(asString); } catch (err) { return { ok: false, error: err.message }; }
  if (typeof parsed.allowed !== "boolean") return { ok: false, error: "missing allowed" };
  return { ok: true, result: parsed };
}

// The real evidence file contains 4 separate captured `cre workflow simulate`
// runs concatenated together (ALLOW, DENY, FALLBACK-DEFAULT, FALLBACK-PERMISSIVE).
// Split on the file's own "CASE:" section markers so each gets parsed independently,
// the same way server.mjs sees exactly one run's stdout per request.
const sections = fullLog.split(/(?=CASE: )/).filter((s) => s.startsWith("CASE: "));

console.log(`Found ${sections.length} real captured CLI runs in PR #100's evidence file.\n`);

let allPassed = true;
for (const section of sections) {
  const caseName = section.split("\n")[0];
  const extracted = extractResultFromCliOutput(section);
  const status = extracted.ok ? "PARSED OK" : "PARSE FAILED";
  if (!extracted.ok) allPassed = false;
  console.log(`[${status}] ${caseName}`);
  if (extracted.ok) {
    console.log(`  -> ${JSON.stringify(extracted.result)}`);
  } else {
    console.log(`  -> error: ${extracted.error}`);
  }
}

console.log(`\n${allPassed ? "ALL SECTIONS PARSED CORRECTLY" : "AT LEAST ONE SECTION FAILED TO PARSE"} against real, previously-captured CLI output.`);
process.exit(allPassed ? 0 : 1);
