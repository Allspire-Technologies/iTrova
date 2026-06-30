// Validation/normalisation for user-entered phone numbers (local or international).

/** Keep only digits and a single leading +, for storing a clean number. */
export function normalizePhone(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  const plus = cleaned.startsWith("+") ? "+" : "";
  return plus + cleaned.replace(/\+/g, "");
}

/** A plausible phone number: 10–15 digits (covers local 11-digit and +country formats). */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}
