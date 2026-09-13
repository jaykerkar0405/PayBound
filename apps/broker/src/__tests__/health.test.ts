import { describe, expect, it } from "vitest";
import { app } from "../index.js";
import { pool } from "../db.js";

describe("GET /health", () => {
  it("returns 200 with { status: 'ok' } when no query params are given", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 200 with status/service/timestamp when verbose=true", async () => {
    const res = await app.request("/health?verbose=true");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string; timestamp: string };
    expect(body).toMatchObject({ status: "ok", service: "broker" });
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("returns 400 when verbose is outside the allowed enum", async () => {
    const res = await app.request("/health?verbose=notabool");

    expect(res.status).toBe(400);
  });
});

describe("db", () => {
  it("exposes a usable, connected Postgres pool", async () => {
    const result = await pool.query("SELECT 1 AS one");
    expect(result.rows[0]).toEqual({ one: 1 });
  });
});
