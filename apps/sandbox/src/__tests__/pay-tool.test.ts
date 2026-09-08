import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type PublicSubmittedPaymentState, type CapabilityId } from "@paybound/capability-spec";
import { payTool, createPayTool, type PayToolResult } from "../tools/pay.js";

describe("Agent Sandbox Payment Tool (Task 2.4)", () => {
  let mockServer: Server;
  let serverPort: number;
  let serverUrl: string;
  let lastRequestBody: unknown = null;
  let serverHandler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    mockServer = createServer((req, res) => {
      let bodyStr = "";
      req.on("data", (chunk) => {
        bodyStr += chunk;
      });
      req.on("end", () => {
        try {
          lastRequestBody = bodyStr ? JSON.parse(bodyStr) : null;
        } catch {
          lastRequestBody = null;
        }
        serverHandler(req, res);
      });
    });

    await new Promise<void>((resolvePromise) => {
      mockServer.listen(0, "127.0.0.1", () => {
        serverPort = (mockServer.address() as AddressInfo).port;
        serverUrl = `http://127.0.0.1:${serverPort}/pay`;
        resolvePromise();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolvePromise) => {
      if (mockServer) {
        mockServer.close(() => resolvePromise());
      } else {
        resolvePromise();
      }
    });
  });

  const validCapabilityId = "c1234567-89ab-cdef-0123-456789abcdef" as CapabilityId;

  const validPublicSubmittedState: PublicSubmittedPaymentState = {
    status: "SUBMITTED",
    capability: {
      taskHash: "0x1234567890abcdef",
      resourceId: "r1234567-89ab-cdef-0123-456789abcdef",
      recipient: "0x9876543210fedcba",
      exactAmount: "10.50",
      paymentRequestHash: "0xabcdef1234567890",
      session: "302a300506032b6570032100" + "0".repeat(64),
      expiry: "2026-12-31T23:59:59.000Z",
      maxUses: 1,
    },
    reservedFrom: {
      status: "RESERVED",
      capability: {
        taskHash: "0x1234567890abcdef",
        resourceId: "r1234567-89ab-cdef-0123-456789abcdef",
        recipient: "0x9876543210fedcba",
        exactAmount: "10.50",
        paymentRequestHash: "0xabcdef1234567890",
        session: "302a300506032b6570032100" + "0".repeat(64),
        expiry: "2026-12-31T23:59:59.000Z",
        maxUses: 1,
      },
      issuedFrom: {
        status: "ISSUED",
        capability: {
          taskHash: "0x1234567890abcdef",
          resourceId: "r1234567-89ab-cdef-0123-456789abcdef",
          recipient: "0x9876543210fedcba",
          exactAmount: "10.50",
          paymentRequestHash: "0xabcdef1234567890",
          session: "302a300506032b6570032100" + "0".repeat(64),
          expiry: "2026-12-31T23:59:59.000Z",
          maxUses: 1,
        },
      },
    },
  };

  describe("Structural Invariant & Parameter Surface", () => {
    it("has strictly exactly one parameter in inputSchema: capabilityId", () => {
      expect(payTool.inputSchema).toBeDefined();

      const unwrapped =
        "unwrap" in payTool.inputSchema && typeof payTool.inputSchema.unwrap === "function"
          ? payTool.inputSchema.unwrap()
          : payTool.inputSchema;

      const keys = Object.keys((unwrapped as { shape: Record<string, unknown> }).shape);

      // Hard architectural invariant: exactly one parameter, capabilityId
      expect(keys).toEqual(["capabilityId"]);
      expect(keys).toHaveLength(1);
    });

    it("accepts valid { capabilityId } input", () => {
      const parseResult = payTool.inputSchema.safeParse({ capabilityId: validCapabilityId });
      expect(parseResult.success).toBe(true);
    });

    it("rejects input missing capabilityId", () => {
      const parseResult = payTool.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });

    it("rejects injected parameters (destination, amount, resource) when evaluated strictly", () => {
      const unwrapped =
        "unwrap" in payTool.inputSchema && typeof payTool.inputSchema.unwrap === "function"
          ? payTool.inputSchema.unwrap()
          : payTool.inputSchema;

      const strictSchema = (
        unwrapped as unknown as { strict: () => typeof payTool.inputSchema }
      ).strict();

      const injectedDestination = strictSchema.safeParse({
        capabilityId: validCapabilityId,
        destination: "0xmalicious_recipient",
      });
      expect(injectedDestination.success).toBe(false);

      const injectedAmount = strictSchema.safeParse({
        capabilityId: validCapabilityId,
        amount: "999999.00",
      });
      expect(injectedAmount.success).toBe(false);

      const injectedResource = strictSchema.safeParse({
        capabilityId: validCapabilityId,
        resource: "untrusted_resource",
      });
      expect(injectedResource.success).toBe(false);
    });
  });

  describe("Broker Response Handling", () => {
    it("handles 200 OK success response returning { success: true, state }", async () => {
      serverHandler = (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ state: validPublicSubmittedState }));
      };

      const testTool = createPayTool({ brokerUrl: serverUrl });
      const result = await testTool.execute({ capabilityId: validCapabilityId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.state).toBeDefined();
        expect(result.state.status).toBe("SUBMITTED");
        expect(result.state.capability.exactAmount).toBe("10.50");
      }

      // Assert wire body passed to Broker had exactly { capabilityId }
      expect(lastRequestBody).toEqual({ capabilityId: validCapabilityId });
    });

    it("handles 200 OK authorization rejection returning { success: false, error: 'payment_rejected', reason }", async () => {
      serverHandler = (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ authorized: false, reason: "REPLAY" }));
      };

      const testTool = createPayTool({ brokerUrl: serverUrl });
      const result = await testTool.execute({ capabilityId: validCapabilityId });

      expect(result.success).toBe(false);
      if (!result.success && result.error === "payment_rejected") {
        expect(result.error).toBe("payment_rejected");
        expect(result.message).toBe("Payment authorization rejected by Broker");
        expect(result.reason).toBe("REPLAY");
      }
    });

    it("handles 404 Not Found returning { success: false, error: 'capability_not_found' } without unhandled throw", async () => {
      serverHandler = (_req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "capability_not_found", capabilityId: validCapabilityId }));
      };

      const testTool = createPayTool({ brokerUrl: serverUrl });
      const result: PayToolResult = await testTool.execute({ capabilityId: validCapabilityId });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("capability_not_found");
        expect(result.message).toContain("Capability not found");
      }
    });

    it("handles 400 Bad Request returning { success: false, error: 'invalid_capability_id' } without unhandled throw", async () => {
      serverHandler = (_req, res) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "invalid_capability_id",
            message: "capabilityId is malformed",
          }),
        );
      };

      const testTool = createPayTool({ brokerUrl: serverUrl });
      const result: PayToolResult = await testTool.execute({ capabilityId: validCapabilityId });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("invalid_capability_id");
        expect(result.message).toBe("capabilityId is malformed");
      }
    });

    it("handles network transport failure gracefully without crashing the tool", async () => {
      // Intentionally point to an unused port to simulate connection refused
      const unusedPortTool = createPayTool({ brokerUrl: "http://127.0.0.1:59999/pay" });
      const result = await unusedPortTool.execute({ capabilityId: validCapabilityId });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("transport_error");
        expect(result.message).toContain("Failed to connect to Broker pay endpoint");
      }
    });
  });
});
