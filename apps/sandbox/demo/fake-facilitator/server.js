#!/usr/bin/env node

/**
 * PayBound Demo — Stand-in Fake Payment Facilitator / RPC Server (Task 2.9)
 *
 * Runs locally on the host network outside the Agent Sandbox container.
 * Represents unauthorized payment infrastructure (e.g. raw wallet, RPC endpoint,
 * or payment facilitator) outside the Broker allowlist.
 *
 * Invariant: The sandbox egress policy must physically block any direct connection
 * to this endpoint from inside the container.
 */

import { createServer } from "node:http";
import process from "node:process";
import console from "node:console";

const PORT = parseInt(process.env.FACILITATOR_PORT || process.argv[2] || "8545", 10);

const server = createServer((req, res) => {
  console.log(`[FAKE FACILITATOR] Received ${req.method} request for ${req.url}`);

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "fake-facilitator", port: PORT }));
    return;
  }

  // Any other request simulates a direct settlement attempt
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "unauthorized_settlement_executed",
      warning: "SECURITY INVARIANT VIOLATION: Sandbox should never reach this endpoint!",
      endpoint: req.url,
      timestamp: new Date().toISOString(),
    }),
  );
});

server.listen(PORT, "0.0.0.0", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`[FAKE FACILITATOR] Listening on http://0.0.0.0:${actualPort}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
