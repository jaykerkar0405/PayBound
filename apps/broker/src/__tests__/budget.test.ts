import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTask, getTask, tryReserveBudget, increaseTaskBudget } from "../budget.js";
import { hashCanonical } from "../hash.js";

describe("budget", () => {
  it("createTask + getTask returns spentSoFar '0' and the given maxTotalSpend", () => {
    const taskHash = hashCanonical(randomUUID());

    createTask(taskHash, "100.00");

    expect(getTask(taskHash)).toEqual({
      taskHash,
      maxTotalSpend: "100.00",
      spentSoFar: "0",
    });
  });

  it("fails to create a task with a taskHash that already exists", () => {
    const taskHash = hashCanonical(randomUUID());
    createTask(taskHash, "100.00");

    expect(() => createTask(taskHash, "999.00")).toThrow();

    // spentSoFar/maxTotalSpend from the original creation are untouched.
    expect(getTask(taskHash)).toEqual({
      taskHash,
      maxTotalSpend: "100.00",
      spentSoFar: "0",
    });
  });

  it("reserves an amount that fits within remaining budget, updating spentSoFar", () => {
    const taskHash = hashCanonical(randomUUID());
    createTask(taskHash, "100.00");

    const result = tryReserveBudget(taskHash, "30.00");

    expect(result).toBe(true);
    expect(getTask(taskHash)?.spentSoFar).toBe("30.00");
  });

  it("rejects an amount that would exceed maxTotalSpend, leaving spentSoFar unchanged", () => {
    const taskHash = hashCanonical(randomUUID());
    createTask(taskHash, "100.00");
    tryReserveBudget(taskHash, "90.00");

    const result = tryReserveBudget(taskHash, "20.00");

    expect(result).toBe(false);
    expect(getTask(taskHash)?.spentSoFar).toBe("90.00");
  });

  it("boundary: an amount that brings spentSoFar to exactly maxTotalSpend succeeds", () => {
    const taskHash = hashCanonical(randomUUID());
    createTask(taskHash, "100.00");

    const result = tryReserveBudget(taskHash, "100.00");

    expect(result).toBe(true);
    expect(getTask(taskHash)?.spentSoFar).toBe("100.00");
  });

  it("under concurrent reservation attempts, exactly one succeeds", async () => {
    const taskHash = hashCanonical(randomUUID());
    createTask(taskHash, "10");

    const attempts = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => tryReserveBudget(taskHash, "10")),
    );
    const results = await Promise.all(attempts);

    const successes = results.filter((result) => result === true);
    expect(successes).toHaveLength(1);
    expect(getTask(taskHash)?.spentSoFar).toBe("10");
  });

  it("is exact on decimal amounts that would drift under naive floating-point arithmetic", () => {
    const taskHash = hashCanonical(randomUUID());
    createTask(taskHash, "0.3");

    expect(tryReserveBudget(taskHash, "0.1")).toBe(true);
    expect(tryReserveBudget(taskHash, "0.2")).toBe(true);
    expect(getTask(taskHash)?.spentSoFar).toBe("0.3");

    // Confirms the budget is now exhausted, not left with floating-point slack.
    expect(tryReserveBudget(taskHash, "0.01")).toBe(false);
  });

  describe("increaseTaskBudget", () => {
    it("raises maxTotalSpend, leaving spentSoFar untouched", () => {
      const taskHash = hashCanonical(randomUUID());
      createTask(taskHash, "10.00");
      tryReserveBudget(taskHash, "5.00");

      increaseTaskBudget(taskHash, "1000.00");

      expect(getTask(taskHash)).toEqual({
        taskHash,
        maxTotalSpend: "1000.00",
        spentSoFar: "5.00",
      });
    });

    it("is a no-op when the given value is not strictly greater than the current maxTotalSpend", () => {
      const taskHash = hashCanonical(randomUUID());
      createTask(taskHash, "100.00");

      increaseTaskBudget(taskHash, "100.00");
      expect(getTask(taskHash)?.maxTotalSpend).toBe("100.00");

      increaseTaskBudget(taskHash, "50.00");
      expect(getTask(taskHash)?.maxTotalSpend).toBe("100.00");
    });

    it("lets a reservation that previously would have exceeded budget succeed after raising it", () => {
      const taskHash = hashCanonical(randomUUID());
      createTask(taskHash, "10.00");
      tryReserveBudget(taskHash, "10.00");

      expect(tryReserveBudget(taskHash, "5.00")).toBe(false);

      increaseTaskBudget(taskHash, "20.00");

      expect(tryReserveBudget(taskHash, "5.00")).toBe(true);
      expect(getTask(taskHash)?.spentSoFar).toBe("15.00");
    });

    it("throws for a taskHash with no existing task", () => {
      const taskHash = hashCanonical(randomUUID());
      expect(() => increaseTaskBudget(taskHash, "100.00")).toThrow();
    });
  });
});
