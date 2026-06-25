export type LegalLink = { slug: string; label: string; description: string; href: string };

export const LEGAL_LINKS: LegalLink[] = [
  { slug: "privacy", label: "Privacy Policy", description: "How we collect, use and protect your data.", href: "https://allspire.tech/privacy" },
  { slug: "terms", label: "Terms of Service", description: "The rules and conditions for using iTrova.", href: "https://allspire.tech/terms" },
  { slug: "dpa", label: "Data Processing Agreement", description: "How we process data on your behalf (DPA).", href: "https://allspire.tech/dpa" },
];

export function getLegalLink(slug: string | undefined): LegalLink | undefined {
  return LEGAL_LINKS.find(l => l.slug === slug);
}

/** Guards against a broken link slipping in — must be an absolute https allspire.tech URL. */
export function isValidLegalHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname === "allspire.tech" && url.pathname.length > 1;
  } catch {
    return false;
  }
}
