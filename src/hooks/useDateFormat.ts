import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }; // DD MMM YYYY
const DATETIME_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * Date/time formatting bound to the logged-in business's timezone.
 * - fmtDate: date only (defaults to "20 Jun 2026")
 * - fmtDateTime: date + time in 12-hour AM/PM (defaults to "20 Jun 2026, 2:30 PM")
 * Pass an Intl.DateTimeFormatOptions to override the shape entirely.
 */
export function useDateFormat() {
  const { business } = useAuth();
  const timezone = business?.timezone ?? "Africa/Lagos";
  return {
    timezone,
    fmtDate: (value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = DATE_OPTS) =>
      formatDate(value, timezone, opts),
    // hour12 is merged first so every time display is AM/PM unless a caller opts out.
    fmtDateTime: (value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = DATETIME_OPTS) =>
      formatDate(value, timezone, { hour12: true, ...opts }),
  };
}
