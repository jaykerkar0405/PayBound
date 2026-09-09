import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { config } from "./config.js";
import "./db.js";
import { payRoute } from "./routes/pay.js";
import { issueRoute } from "./routes/issue.js";
import { sweepRecoverablePayments } from "./settlement.js";

const app = new Hono();

const healthQuerySchema = z.object({
  verbose: z.enum(["true", "false"]).optional(),
});

app.get("/health", zValidator("query", healthQuerySchema), (c) => {
  const { verbose } = c.req.valid("query");
  const body =
    verbose === "true"
      ? { status: "ok", service: "broker", timestamp: new Date().toISOString() }
      : { status: "ok" };
  return c.json(body);
});

app.route("/pay", payRoute);
app.route("/issue", issueRoute);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`broker listening on http://localhost:${info.port}`);
  // Reconcile any RECOVERABLE payments left over from a prior crash,
  // using the mirror-node fallback so aged receipts are not a blocker.
  sweepRecoverablePayments().catch(console.error);
});

export { app };
