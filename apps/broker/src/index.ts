import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

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

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`broker listening on http://localhost:${info.port}`);
});

export { app };
