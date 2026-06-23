export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const COUNTDOWN_MS = 10 * 1000;

export type IdlePhase = "active" | "warning" | "expired";

export interface IdleStatus {
  phase: IdlePhase;
  secondsLeft: number;
}

export function idleStatus(
  now: number,
  lastActivity: number,
  idleLimitMs: number = IDLE_LIMIT_MS,
  countdownMs: number = COUNTDOWN_MS,
): IdleStatus {
  const idleFor = now - lastActivity;
  if (idleFor < idleLimitMs) {
    return { phase: "active", secondsLeft: Math.ceil(countdownMs / 1000) };
  }
  const intoCountdown = idleFor - idleLimitMs;
  if (intoCountdown >= countdownMs) {
    return { phase: "expired", secondsLeft: 0 };
  }
  return { phase: "warning", secondsLeft: Math.ceil((countdownMs - intoCountdown) / 1000) };
}
