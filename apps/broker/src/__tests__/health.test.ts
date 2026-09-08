import { describe, expect, it } from "vitest";
import { app } from "../index.js";
import { db } from "../db.js";

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
  it("exposes a usable better-sqlite3 Database in WAL mode", () => {
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  });
});
