import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);
const IMAGE_TAG = "paybound-sandbox-test";
const SANDBOX_DIR = resolve(__dirname, "../..");

describe("Sandbox Network Egress Policy (Task 2.2)", () => {
  let brokerServer: Server;
  let paymentServer: Server;
  let brokerPort: number;
  let paymentPort: number;

  beforeAll(async () => {
    // 1. Ensure Docker image is built with current network configuration
    await execFileAsync("docker", ["build", "-t", IMAGE_TAG, SANDBOX_DIR], {
      timeout: 120_000,
    });

    // 2. Start mock Broker listener
    brokerServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "broker_connected" }));
    });
    await new Promise<void>((resolvePromise) => {
      brokerServer.listen(0, "0.0.0.0", () => {
        brokerPort = (brokerServer.address() as AddressInfo).port;
        resolvePromise();
      });
    });

    // 3. Start stand-in Payment Infrastructure listener
    paymentServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "payment_settled" }));
    });
    await new Promise<void>((resolvePromise) => {
      paymentServer.listen(0, "0.0.0.0", () => {
        paymentPort = (paymentServer.address() as AddressInfo).port;
        resolvePromise();
      });
    });
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((r) => (brokerServer ? brokerServer.close(() => r()) : r())),
      new Promise<void>((r) => (paymentServer ? paymentServer.close(() => r()) : r())),
    ]);
  });

  it("applies the egress policy automatically on container startup without manual setup", async () => {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--cap-add=NET_ADMIN",
        "--add-host=host.docker.internal:host-gateway",
        "-e",
        "BROKER_HOST=host.docker.internal",
        "-e",
        `BROKER_PORT=${brokerPort}`,
        IMAGE_TAG,
      ],
      { timeout: 15_000 },
    );

    expect(stdout).toContain(
      "Sandbox egress policy applied: Web allowed, payment infra blocked, Broker exception allowed on",
    );
    expect(stdout).toContain("PayBound Agent Sandbox started (network isolated)");
  });

  it("allows outbound HTTPS requests to arbitrary public web hosts", async () => {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--cap-add=NET_ADMIN",
        "--add-host=host.docker.internal:host-gateway",
        "-e",
        "BROKER_HOST=host.docker.internal",
        "-e",
        `BROKER_PORT=${brokerPort}`,
        IMAGE_TAG,
        "curl",
        "-sSf",
        "--connect-timeout",
        "5",
        "https://example.com",
      ],
      { timeout: 20_000 },
    );

    expect(stdout).toContain("Example Domain");
  });

  it("allows outbound HTTP requests to the single designated Broker host/port", async () => {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--cap-add=NET_ADMIN",
        "--add-host=host.docker.internal:host-gateway",
        "-e",
        "BROKER_HOST=host.docker.internal",
        "-e",
        `BROKER_PORT=${brokerPort}`,
        IMAGE_TAG,
        "curl",
        "-sSf",
        "--connect-timeout",
        "3",
        `http://host.docker.internal:${brokerPort}`,
      ],
      { timeout: 15_000 },
    );

    expect(stdout).toContain("broker_connected");
  });

  it("blocks outbound requests to stand-in payment infrastructure hosts (legacy PAYMENT_INFRA_HOST)", async () => {
    let failed = false;
    try {
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--cap-add=NET_ADMIN",
          "--add-host=host.docker.internal:host-gateway",
          "-e",
          "BROKER_HOST=host.docker.internal",
          "-e",
          `BROKER_PORT=${brokerPort}`,
          "-e",
          "PAYMENT_INFRA_HOST=host.docker.internal",
          "-e",
          `PAYMENT_INFRA_PORT=${paymentPort}`,
          IMAGE_TAG,
          "curl",
          "-sSf",
          "--connect-timeout",
          "2",
          `http://host.docker.internal:${paymentPort}`,
        ],
        { timeout: 15_000 },
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });

  it("blocks outbound requests to named payment-infrastructure targets (PAYMENT_INFRA_HOSTS list)", async () => {
    let failed = false;
    try {
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--cap-add=NET_ADMIN",
          "--add-host=host.docker.internal:host-gateway",
          "-e",
          "BROKER_HOST=host.docker.internal",
          "-e",
          `BROKER_PORT=${brokerPort}`,
          "-e",
          `PAYMENT_INFRA_HOSTS=host.docker.internal:${paymentPort},example.org:9999`,
          IMAGE_TAG,
          "curl",
          "-sSf",
          "--connect-timeout",
          "2",
          `http://host.docker.internal:${paymentPort}`,
        ],
        { timeout: 15_000 },
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });

  it("blocks the Docker host gateway even when no named payment-infra host is configured", async () => {
    let failed = false;
    try {
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--cap-add=NET_ADMIN",
          "--add-host=host.docker.internal:host-gateway",
          "-e",
          "BROKER_HOST=host.docker.internal",
          "-e",
          `BROKER_PORT=${brokerPort}`,
          IMAGE_TAG,
          "curl",
          "-sSf",
          "--connect-timeout",
          "2",
          `http://host.docker.internal:${paymentPort}`,
        ],
        { timeout: 15_000 },
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });

  it("allows outbound HTTPS requests to a second arbitrary host not referenced elsewhere, proving the policy is default-deny-then-selectively-allow rather than special-cased to example.com/Broker", async () => {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--cap-add=NET_ADMIN",
        "--add-host=host.docker.internal:host-gateway",
        "-e",
        "BROKER_HOST=host.docker.internal",
        "-e",
        `BROKER_PORT=${brokerPort}`,
        IMAGE_TAG,
        "curl",
        "-sSf",
        "--connect-timeout",
        "5",
        "https://httpbin.org/get",
      ],
      { timeout: 20_000 },
    );

    expect(stdout).toContain('"url"');
  });

  it("blocks requests if Broker host/port is misconfigured to a different port", async () => {
    const disallowedPort = paymentPort;
    let failed = false;

    try {
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--cap-add=NET_ADMIN",
          "--add-host=host.docker.internal:host-gateway",
          "-e",
          "BROKER_HOST=host.docker.internal",
          "-e",
          `BROKER_PORT=${brokerPort}`,
          IMAGE_TAG,
          "curl",
          "-sSf",
          "--connect-timeout",
          "2",
          `http://host.docker.internal:${disallowedPort}`,
        ],
        { timeout: 15_000 },
      );
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });

  it("exposes typed environment-derived configuration from config.ts", () => {
    expect(config).toBeDefined();
    expect(typeof config.brokerHost).toBe("string");
    expect(typeof config.brokerPort).toBe("number");
    expect(typeof config.nodeEnv).toBe("string");
  });
});
