import { describe, it, expect } from "vitest";
import { idleStatus, IDLE_LIMIT_MS, COUNTDOWN_MS } from "./idleTimeout";

const START = 1_000_000;

describe("idleStatus", () => {
  it("is active while within the idle limit", () => {
    expect(idleStatus(START, START)).toEqual({ phase: "active", secondsLeft: 10 });
    expect(idleStatus(START + IDLE_LIMIT_MS - 1, START)).toEqual({ phase: "active", secondsLeft: 10 });
  });

  it("enters the warning the moment the idle limit is reached", () => {
    expect(idleStatus(START + IDLE_LIMIT_MS, START)).toEqual({ phase: "warning", secondsLeft: 10 });
  });

  it("counts the warning down as time passes", () => {
    expect(idleStatus(START + IDLE_LIMIT_MS + 500, START).secondsLeft).toBe(10);
    expect(idleStatus(START + IDLE_LIMIT_MS + 1000, START).secondsLeft).toBe(9);
    expect(idleStatus(START + IDLE_LIMIT_MS + 9500, START).secondsLeft).toBe(1);
  });

  it("expires once the countdown elapses", () => {
    expect(idleStatus(START + IDLE_LIMIT_MS + COUNTDOWN_MS, START)).toEqual({ phase: "expired", secondsLeft: 0 });
    expect(idleStatus(START + IDLE_LIMIT_MS + COUNTDOWN_MS + 5000, START)).toEqual({ phase: "expired", secondsLeft: 0 });
  });

  it("resets to active when activity is recent", () => {
    const now = START + IDLE_LIMIT_MS + 3000;
    expect(idleStatus(now, now)).toEqual({ phase: "active", secondsLeft: 10 });
  });

  it("honours custom idle limit and countdown", () => {
    const idle = 5000;
    const countdown = 2000;
    expect(idleStatus(START + 4000, START, idle, countdown)).toEqual({ phase: "active", secondsLeft: 2 });
    expect(idleStatus(START + 5000, START, idle, countdown)).toEqual({ phase: "warning", secondsLeft: 2 });
    expect(idleStatus(START + 6000, START, idle, countdown)).toEqual({ phase: "warning", secondsLeft: 1 });
    expect(idleStatus(START + 7000, START, idle, countdown)).toEqual({ phase: "expired", secondsLeft: 0 });
  });
});
