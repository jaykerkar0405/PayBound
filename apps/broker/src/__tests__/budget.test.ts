import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTask, getTask, tryReserveBudget, increaseTaskBudget } from "../budget.js";
import { hashCanonical } from "../hash.js";

describe("budget", () => {
  it("createTask + getTask returns spentSoFar '0' and the given maxTotalSpend", async () => {
    const taskHash = hashCanonical(randomUUID());

    await createTask(taskHash, "100.00");

    expect(await getTask(taskHash)).toEqual({
      taskHash,
      maxTotalSpend: "100.00",
      spentSoFar: "0",
    });
  });

  it("fails to create a task with a taskHash that already exists", async () => {
    const taskHash = hashCanonical(randomUUID());
    await createTask(taskHash, "100.00");

    await expect(createTask(taskHash, "999.00")).rejects.toThrow();

    // spentSoFar/maxTotalSpend from the original creation are untouched.
    expect(await getTask(taskHash)).toEqual({
      taskHash,
      maxTotalSpend: "100.00",
      spentSoFar: "0",
    });
  });

  it("reserves an amount that fits within remaining budget, updating spentSoFar", async () => {
    const taskHash = hashCanonical(randomUUID());
    await createTask(taskHash, "100.00");

    const result = await tryReserveBudget(taskHash, "30.00");

    expect(result).toBe(true);
    expect((await getTask(taskHash))?.spentSoFar).toBe("30.00");
  });

  it("rejects an amount that would exceed maxTotalSpend, leaving spentSoFar unchanged", async () => {
    const taskHash = hashCanonical(randomUUID());
    await createTask(taskHash, "100.00");
    await tryReserveBudget(taskHash, "90.00");

    const result = await tryReserveBudget(taskHash, "20.00");

    expect(result).toBe(false);
    expect((await getTask(taskHash))?.spentSoFar).toBe("90.00");
  });

  it("boundary: an amount that brings spentSoFar to exactly maxTotalSpend succeeds", async () => {
    const taskHash = hashCanonical(randomUUID());
    await createTask(taskHash, "100.00");

    const result = await tryReserveBudget(taskHash, "100.00");

    expect(result).toBe(true);
    expect((await getTask(taskHash))?.spentSoFar).toBe("100.00");
  });

  it("under concurrent reservation attempts, exactly one succeeds", async () => {
    const taskHash = hashCanonical(randomUUID());
    await createTask(taskHash, "10");

    const attempts = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => tryReserveBudget(taskHash, "10")),
    );
    const results = await Promise.all(attempts);

    const successes = results.filter((result) => result === true);
    expect(successes).toHaveLength(1);
    expect((await getTask(taskHash))?.spentSoFar).toBe("10");
  });

  it("is exact on decimal amounts that would drift under naive floating-point arithmetic", async () => {
    const taskHash = hashCanonical(randomUUID());
    await createTask(taskHash, "0.3");

    expect(await tryReserveBudget(taskHash, "0.1")).toBe(true);
    expect(await tryReserveBudget(taskHash, "0.2")).toBe(true);
    expect((await getTask(taskHash))?.spentSoFar).toBe("0.3");

    // Confirms the budget is now exhausted, not left with floating-point slack.
    expect(await tryReserveBudget(taskHash, "0.01")).toBe(false);
  });

  describe("increaseTaskBudget", () => {
    it("raises maxTotalSpend, leaving spentSoFar untouched", async () => {
      const taskHash = hashCanonical(randomUUID());
      await createTask(taskHash, "10.00");
      await tryReserveBudget(taskHash, "5.00");

      await increaseTaskBudget(taskHash, "1000.00");

      expect(await getTask(taskHash)).toEqual({
        taskHash,
        maxTotalSpend: "1000.00",
        spentSoFar: "5.00",
      });
    });

    it("is a no-op when the given value is not strictly greater than the current maxTotalSpend", async () => {
      const taskHash = hashCanonical(randomUUID());
      await createTask(taskHash, "100.00");

      await increaseTaskBudget(taskHash, "100.00");
      expect((await getTask(taskHash))?.maxTotalSpend).toBe("100.00");

      await increaseTaskBudget(taskHash, "50.00");
      expect((await getTask(taskHash))?.maxTotalSpend).toBe("100.00");
    });

    it("lets a reservation that previously would have exceeded budget succeed after raising it", async () => {
      const taskHash = hashCanonical(randomUUID());
      await createTask(taskHash, "10.00");
      await tryReserveBudget(taskHash, "10.00");

      expect(await tryReserveBudget(taskHash, "5.00")).toBe(false);

      await increaseTaskBudget(taskHash, "20.00");

      expect(await tryReserveBudget(taskHash, "5.00")).toBe(true);
      expect((await getTask(taskHash))?.spentSoFar).toBe("15.00");
    });

    it("throws for a taskHash with no existing task", async () => {
      const taskHash = hashCanonical(randomUUID());
      await expect(increaseTaskBudget(taskHash, "100.00")).rejects.toThrow();
    });
  });
});
