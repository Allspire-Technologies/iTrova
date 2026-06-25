/** A Supabase user is verified once email_confirmed_at is set. */
export function isEmailConfirmed(user: { email_confirmed_at?: string | null } | null | undefined): boolean {
  return !!user?.email_confirmed_at;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export type VerifyAction = "change" | "resend";

/** Verifying a changed address sends a fresh confirmation; an unchanged one just resends. */
export function verifyAction(currentEmail: string | null | undefined, nextEmail: string): VerifyAction {
  return normalizeEmail(nextEmail) !== normalizeEmail(currentEmail ?? "") ? "change" : "resend";
}
