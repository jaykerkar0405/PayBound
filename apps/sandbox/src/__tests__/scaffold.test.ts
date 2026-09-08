import { describe, expect, it, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { main } from "../index.js";

const IMAGE_TAG = "paybound-sandbox-test";
const SANDBOX_DIR = resolve(__dirname, "../..");

describe("Agent Sandbox Scaffolding & Runtime Isolation (Task 2.1)", () => {
  beforeAll(() => {
    // Build the Docker image from apps/sandbox with generous timeout
    const buildResult = spawnSync(
      "docker",
      ["build", "-t", IMAGE_TAG, SANDBOX_DIR],
      {
        encoding: "utf-8",
        timeout: 120_000,
      }
    );

    if (buildResult.status !== 0) {
      throw new Error(
        `Failed to build Docker image:\nSTDOUT: ${buildResult.stdout}\nSTDERR: ${buildResult.stderr}`
      );
    }
    expect(buildResult.status).toBe(0);
  });

  it("starts the container and runs the compiled entrypoint cleanly without crashing", () => {
    const result = spawnSync("docker", ["run", "--rm", IMAGE_TAG], {
      encoding: "utf-8",
      timeout: 15_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PayBound Agent Sandbox started (network isolated)"
    );
  });

  it("blocks outbound network access by default (no network flags provided)", () => {
    // Attempting an outbound HTTP request without --network flags must fail/time out
    const curlResult = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        IMAGE_TAG,
        "curl",
        "-sSf",
        "--connect-timeout",
        "3",
        "https://example.com",
      ],
      {
        encoding: "utf-8",
        timeout: 15_000,
      }
    );

    // Command must fail with non-zero exit code due to DNS resolution failure or network drop
    expect(curlResult.status).not.toBe(0);
  });

  it("fails outbound fetch inside Node runtime when running with default network posture", () => {
    const nodeResult = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        IMAGE_TAG,
        "node",
        "-e",
        'fetch("https://example.com").then(() => process.exit(0)).catch(() => process.exit(1));',
      ],
      {
        encoding: "utf-8",
        timeout: 15_000,
      }
    );

    expect(nodeResult.status).not.toBe(0);
  });

  it("confirms zero network connectivity when run with explicit --network none", () => {
    const curlResult = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        IMAGE_TAG,
        "curl",
        "-sSf",
        "--connect-timeout",
        "3",
        "https://example.com",
      ],
      {
        encoding: "utf-8",
        timeout: 15_000,
      }
    );

    expect(curlResult.status).not.toBe(0);
  });

  it("executes the in-process main() entrypoint function without error", () => {
    expect(() => main()).not.toThrow();
  });
});
