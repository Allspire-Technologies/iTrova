// Time-of-day greeting for the Dashboard.
// Morning starts at midnight (00:00–11:59), afternoon 12:00–16:59, evening 17:00–23:59.

export type GreetingPart = "morning" | "afternoon" | "evening";

export function greetingPart(date: Date = new Date()): GreetingPart {
  const h = date.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

/** "Good morning" | "Good afternoon" | "Good evening" for the given local time. */
export function greeting(date: Date = new Date()): string {
  return `Good ${greetingPart(date)}`;
}
