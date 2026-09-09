/**
 * PayBound Agent Sandbox — Network Boundary Demonstration Harness Tests (Task 2.9)
 *
 * Automates verification of the live demonstration script (demo/network-boundary-demo.sh)
 * and its underlying components (fake-facilitator server and container network egress).
 *
 * Criteria per docs/TASKS.md Task 2.9:
 * 1. Executes real blocked call to fake facilitator stand-in and captures real failure.
 * 2. Executes real allowed call to Broker channel and captures real success.
 * 3. Asserts human-legible output with clear indicators (ALLOWED / BLOCKED).
 * 4. Verifies bounded execution time without hanging indefinitely.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const execFileAsync = promisify(execFile);

const DEMO_SCRIPT = resolve(__dirname, "../../demo/network-boundary-demo.sh");
const FAKE_FACILITATOR_SCRIPT = resolve(__dirname, "../../demo/fake-facilitator/server.js");

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mK]/g, "");
}

describe("Live Demonstration Harness — Network Boundary Claim (Task 2.9)", () => {
  describe("Fake Facilitator Stand-in Server", () => {
    let facilitatorProcess: ChildProcess;
    let facilitatorPort: number;

    beforeAll(async () => {
      // Find an available port
      const tmpServer = createServer();
      await new Promise<void>((res) => {
        tmpServer.listen(0, "127.0.0.1", () => {
          facilitatorPort = (tmpServer.address() as AddressInfo).port;
          tmpServer.close(() => res());
        });
      });

      // Spawn fake facilitator
      facilitatorProcess = spawn("node", [FAKE_FACILITATOR_SCRIPT, String(facilitatorPort)], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Wait for server to start listening
      await new Promise<void>((res, rej) => {
        const timeout = setTimeout(() => rej(new Error("Fake facilitator timed out starting")), 5000);
        facilitatorProcess.stdout?.on("data", (data) => {
          if (data.toString().includes("Listening on")) {
            clearTimeout(timeout);
            res();
          }
        });
      });
    });

    afterAll(() => {
      if (facilitatorProcess && !facilitatorProcess.killed) {
        facilitatorProcess.kill("SIGTERM");
      }
    });

    it("verifies fake facilitator is genuinely reachable from host network", async () => {
      const response = await fetch(`http://127.0.0.1:${facilitatorPort}/health`);
      expect(response.status).toBe(200);
      const data = (await response.json()) as { status: string; service: string };
      expect(data.status).toBe("ok");
      expect(data.service).toBe("fake-facilitator");
    });

    it("confirms fake facilitator returns settlement simulation payload for arbitrary routes", async () => {
      const response = await fetch(`http://127.0.0.1:${facilitatorPort}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "100", recipient: "0xATTACKER" }),
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { status: string; warning: string };
      expect(data.status).toBe("unauthorized_settlement_executed");
      expect(data.warning).toContain("SECURITY INVARIANT VIOLATION");
    });
  });

  describe("End-to-End Demonstration Script Execution", () => {
    let brokerServer: Server;
    let facilitatorServer: Server;
    let brokerPort: number;
    let facilitatorPort: number;

    beforeAll(async () => {
      // 1. Dedicated mock Broker listener
      brokerServer = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "broker", channel: "test_harness" }));
      });
      await new Promise<void>((res) => {
        brokerServer.listen(0, "0.0.0.0", () => {
          brokerPort = (brokerServer.address() as AddressInfo).port;
          res();
        });
      });

      // 2. Dedicated stand-in Payment Facilitator listener
      facilitatorServer = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "facilitator_bypassed" }));
      });
      await new Promise<void>((res) => {
        facilitatorServer.listen(0, "0.0.0.0", () => {
          facilitatorPort = (facilitatorServer.address() as AddressInfo).port;
          res();
        });
      });
    });

    afterAll(async () => {
      await Promise.all([
        new Promise<void>((r) => (brokerServer ? brokerServer.close(() => r()) : r())),
        new Promise<void>((r) => (facilitatorServer ? facilitatorServer.close(() => r()) : r())),
      ]);
    });

    it(
      "runs the full demo script end-to-end within bounded timeout and asserts output markers",
      async () => {
        const startTime = Date.now();

        const { stdout: rawStdout } = await execFileAsync(
          "bash",
          [DEMO_SCRIPT],
          {
            env: {
              ...process.env,
              BROKER_PORT: String(brokerPort),
              FACILITATOR_PORT: String(facilitatorPort),
            },
            timeout: 45_000,
          },
        );

        const durationMs = Date.now() - startTime;
        const stdout = stripAnsi(rawStdout);

        // 1. Completed within bounded timeout (should take ~5-15s, well under 45s)
        expect(durationMs).toBeLessThan(40_000);

        // 2. Contains clear presentation header
        expect(stdout).toContain("PayBound Agent Sandbox — Live Network Boundary Demonstration");
        expect(stdout).toContain("Testing architectural claim from docs/ARCHITECTURE.md");

        // 3. Verifies Allowed call section & marker
        expect(stdout).toContain("[1/4] Attempting call to Broker channel (should be ALLOWED)...");
        expect(stdout).toContain("✓ ALLOWED: Successfully reached Broker (200 OK)");

        // 4. Verifies Blocked call section & marker (named payment-infra target, not just gateway)
        expect(stdout).toContain(
          "[2/4] Attempting direct call to named Payment Facilitator target (should be BLOCKED)...",
        );
        expect(stdout).toContain("✗ BLOCKED: Outbound connection to named payment infrastructure target dropped");

        // 5. Verifies Arbitrary Public Web Read section & marker
        expect(stdout).toContain("[3/4] Attempting public web read (should be ALLOWED)...");
        expect(stdout).toContain("✓ ALLOWED: Public web content successfully retrieved");

        // 6. Verifies a SECOND, unrelated arbitrary host is also reachable — proves the
        // policy is default-deny-then-selectively-allow, not special-cased to example.com.
        expect(stdout).toContain(
          "[4/4] Attempting public web read to a second, unrelated host (should be ALLOWED)...",
        );
        expect(stdout).toContain("✓ ALLOWED: Second arbitrary host reachable (policy is not special-cased)");

        // 7. Verifies Summary table & final security conclusion
        expect(stdout).toContain("Demonstration Complete: Network Boundary Guarantee Verified");
        expect(stdout).toContain("Broker Channel");
        expect(stdout).toContain("Named Payment Facilitator");
        expect(stdout).toContain("Public Web Read");
        expect(stdout).toContain("Second Arbitrary Host");
        expect(stdout).toContain("The sandbox cannot reach the named payment-infrastructure");
        expect(stdout).toContain("All payments");
        expect(stdout).toContain("MUST flow through the Broker authorization channel.");
      },
      30_000,
    );

    it(
      "confirms standalone execution works automatically without pre-configured environment variables",
      async () => {
        // Running without BROKER_PORT / FACILITATOR_PORT dynamically allocates ports
        const { stdout: rawStdout } = await execFileAsync("bash", [DEMO_SCRIPT], { timeout: 45_000 });
        const stdout = stripAnsi(rawStdout);

        expect(stdout).toContain("✓ ALLOWED: Successfully reached Broker (200 OK)");
        expect(stdout).toContain("✗ BLOCKED: Outbound connection to named payment infrastructure target dropped");
        expect(stdout).toContain("✓ ALLOWED: Public web content successfully retrieved");
        expect(stdout).toContain("✓ ALLOWED: Second arbitrary host reachable (policy is not special-cased)");
        expect(stdout).toContain("Demonstration Complete: Network Boundary Guarantee Verified");
      },
      30_000,
    );
  });
});
