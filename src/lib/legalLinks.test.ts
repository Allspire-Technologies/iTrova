import { describe, it, expect } from "vitest";
import { LEGAL_LINKS, isValidLegalHref } from "./legalLinks";

describe("LEGAL_LINKS", () => {
  it("exposes the privacy, terms and DPA documents", () => {
    expect(LEGAL_LINKS.map(l => l.href)).toEqual([
      "https://allspire.tech/privacy",
      "https://allspire.tech/terms",
      "https://allspire.tech/dpa",
    ]);
  });
  it("every link has a label, description and a valid href", () => {
    for (const l of LEGAL_LINKS) {
      expect(l.label.trim()).not.toBe("");
      expect(l.description.trim()).not.toBe("");
      expect(isValidLegalHref(l.href)).toBe(true);
    }
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
