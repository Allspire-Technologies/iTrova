export type LegalLink = { label: string; description: string; href: string };

export const LEGAL_LINKS: LegalLink[] = [
  { label: "Privacy Policy", description: "How we collect, use and protect your data.", href: "https://allspire.tech/privacy" },
  { label: "Terms of Service", description: "The rules and conditions for using iTrova.", href: "https://allspire.tech/terms" },
  { label: "Data Processing Agreement", description: "How we process data on your behalf (DPA).", href: "https://allspire.tech/dpa" },
];

/** Guards against a broken link slipping in — must be an absolute https allspire.tech URL. */
export function isValidLegalHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname === "allspire.tech" && url.pathname.length > 1;
  } catch {
    return false;
  }
}
