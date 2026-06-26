/** Two-digit year, month and day, e.g. 2026-06-25 -> "260625". */
export function yymmdd(d: Date = new Date()): string {
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * Client fallback used only if next_invoice_number RPC is unavailable. Keeps the YYMMDD
 * prefix and adds a timestamp suffix so it stays unique and won't clash with the server's
 * small daily sequence. The server function is authoritative for the real YYMMDD-N value.
 */
export function invoiceFallbackNumber(d: Date = new Date()): string {
  return `${yymmdd(d)}-${String(d.getTime()).slice(-6)}`;
}
