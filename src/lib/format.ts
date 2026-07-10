const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  GHS: "₵",
  KES: "KSh",
  ZAR: "R",
  USD: "$",
};

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: "en-NG",
  GHS: "en-GH",
  KES: "en-KE",
  ZAR: "en-ZA",
  USD: "en-US",
};

/** Currency options for dropdowns — single source of truth for Settings & Onboarding. */
export const CURRENCY_OPTIONS = [
  { value: "NGN", label: "₦ Nigerian Naira (NGN)" },
  { value: "GHS", label: "₵ Ghanaian Cedi (GHS)" },
  { value: "KES", label: "KSh Kenyan Shilling (KES)" },
  { value: "ZAR", label: "R South African Rand (ZAR)" },
  { value: "USD", label: "$ US Dollar (USD)" },
];

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

export function formatMoney(n: number | string | null | undefined, currency = "NGN"): string {
  const num = Number(n ?? 0);
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const locale = CURRENCY_LOCALES[currency] ?? "en-NG";
  return symbol + num.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Kept for any code that hasn't migrated to useCurrency() yet. */
export const formatNaira = (n: number | string | null | undefined) => formatMoney(n, "NGN");

/**
 * Timezone-aware date/time formatter. Prefer the useDateFormat() hook in React
 * components so the business timezone is applied automatically; call this
 * directly only from non-React code (e.g. pdf.ts).
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  timezone = "Africa/Lagos",
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }, // DD MMM YYYY
  locale = "en-NG",
): string {
  if (value === null || value === undefined || value === "") return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { timeZone: timezone, ...opts });
}
