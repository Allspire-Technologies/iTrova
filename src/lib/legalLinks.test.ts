import { describe, it, expect } from "vitest";
import { LEGAL_LINKS, getLegalLink, isValidLegalHref } from "./legalLinks";

describe("LEGAL_LINKS", () => {
  it("exposes the privacy, terms and DPA documents", () => {
    expect(LEGAL_LINKS.map(l => l.href)).toEqual([
      "https://allspire.tech/privacy",
      "https://allspire.tech/terms",
      "https://allspire.tech/dpa",
    ]);
  });
  it("every link has a slug, label, description and a valid href", () => {
    for (const l of LEGAL_LINKS) {
      expect(l.slug.trim()).not.toBe("");
      expect(l.label.trim()).not.toBe("");
      expect(l.description.trim()).not.toBe("");
      expect(isValidLegalHref(l.href)).toBe(true);
    }
  });
  it("has unique slugs", () => {
    expect(new Set(LEGAL_LINKS.map(l => l.slug)).size).toBe(LEGAL_LINKS.length);
  });
});

describe("getLegalLink", () => {
  it("resolves a known slug to its document", () => {
    expect(getLegalLink("terms")?.href).toBe("https://allspire.tech/terms");
  });
  it("returns undefined for an unknown or missing slug", () => {
    expect(getLegalLink("unknown")).toBeUndefined();
    expect(getLegalLink(undefined)).toBeUndefined();
  });
});

describe("isValidLegalHref", () => {
  it("accepts an absolute https allspire.tech document URL", () => {
    expect(isValidLegalHref("https://allspire.tech/privacy")).toBe(true);
  });
  it("rejects non-https, wrong host, root path, or malformed URLs", () => {
    expect(isValidLegalHref("http://allspire.tech/privacy")).toBe(false);
    expect(isValidLegalHref("https://evil.com/privacy")).toBe(false);
    expect(isValidLegalHref("https://allspire.tech/")).toBe(false);
    expect(isValidLegalHref("/privacy")).toBe(false);
  });
});
