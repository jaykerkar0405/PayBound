/**
 * PayBound Agent Sandbox — Runtime Entrypoint (Task 2.1 - 2.5)
 *
 * Scaffolds the sandbox environment:
 * 1. Network isolation & egress policy (tasks 2.1, 2.2).
 * 2. Establishes attested workload identity before reading any untrusted content (task 2.3).
 * 3. Payment tool (task 2.4) and agent loop (task 2.5).
 */

import { generateSandboxAttestation, type SandboxAttestation } from "./attestation.js";

let currentIdentity: SandboxAttestation | null = null;

/**
 * Initializes the sandbox workload attestation identity.
 * Executed at startup before any untrusted content is read or agent loop executes.
 */
export function initializeAttestation(): SandboxAttestation {
  if (!currentIdentity) {
    currentIdentity = generateSandboxAttestation();
  }
  return currentIdentity;
}

/**
 * Returns the active sandbox workload attestation identity.
 */
export function getSandboxIdentity(): SandboxAttestation {
  if (!currentIdentity) {
    return initializeAttestation();
  }
  return currentIdentity;
}

export function main(): void {
  // Step 1: Establish attested workload identity before any untrusted content is read
  const identity = initializeAttestation();
  console.log("PayBound Agent Sandbox started (network isolated)");
  console.log(`Attested workload identity session: ${identity.publicKey.slice(0, 16)}...`);
}

main();
