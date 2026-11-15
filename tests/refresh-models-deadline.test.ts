import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { raceWithDeadline } from "@/lib/refresh-deadline";

/**
 * The deadline race mirrors lib/refresh-releases.ts: a plain setTimeout
 * promise raced against the work, timer always cleared. A hang must resolve
 * as {timedOut: true} instead of holding the caller open; a fast result must
 * leave no dangling timer.
 */
describe("raceWithDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the work result and clears the timer when work settles first", async () => {
    let settle!: (v: string) => void;
    const work = new Promise<string>((resolve) => {
      settle = resolve;
    });

    const raced = raceWithDeadline(work, 540000);
    settle("done");

    expect(await raced).toEqual({ timedOut: false, value: "done" });
    expect(vi.getTimerCount()).toBe(0); // no dangling deadline timer
  });

  it("resolves immediately for already-settled work", async () => {
    const result = await raceWithDeadline(Promise.resolve({ fetched: 3 }), 540000);

    expect(result).toEqual({ timedOut: false, value: { fetched: 3 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves {timedOut: true} when the work hangs past the deadline", async () => {
    const raced = raceWithDeadline<string>(new Promise<string>(() => {}), 540000);

    vi.advanceTimersByTime(540000);

    expect(await raced).toEqual({ timedOut: true, value: null });
  });

  it("does not fire before the deadline and still cleans up", async () => {
    let settle!: (v: number) => void;
    const work = new Promise<number>((resolve) => {
      settle = resolve;
    });

    const raced = raceWithDeadline(work, 540000);
    vi.advanceTimersByTime(539999);
    expect(vi.getTimerCount()).toBe(1); // deadline still armed

    settle(42);
    const result = await raced;
    expect(result).toEqual({ timedOut: false, value: 42 });
    expect(vi.getTimerCount()).toBe(0); // timer cleared after settle
  });

  it("propagates a work rejection instead of swallowing it", async () => {
    const raced = raceWithDeadline(Promise.reject(new Error("boom")), 540000);

    await expect(raced).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });
});
