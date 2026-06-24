/** True when any current value differs from its saved baseline (the form is dirty). */
export function isDirty(current: readonly string[], baseline: readonly string[]): boolean {
  return current.some((v, i) => v !== baseline[i]);
}

/** The password form is actionable once both fields have been filled in. */
export function isPasswordFormReady(newPassword: string, confirmPassword: string): boolean {
  return newPassword.length > 0 && confirmPassword.length > 0;
}
