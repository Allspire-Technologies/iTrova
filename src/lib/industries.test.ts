import { describe, it, expect } from "vitest";
import { INDUSTRIES, INDUSTRY_OPTIONS } from "./industries";

describe("INDUSTRIES", () => {
  it("has entries, all non-empty and trimmed", () => {
    expect(INDUSTRIES.length).toBeGreaterThan(0);
    for (const name of INDUSTRIES) {
      expect(name).toBeTruthy();
      expect(name).toBe(name.trim());
    }
  });

  it("has no duplicates (values are segmented on in the CRM)", () => {
    expect(new Set(INDUSTRIES).size).toBe(INDUSTRIES.length);
  });

  it('includes an "Other" catch-all', () => {
    expect(INDUSTRIES).toContain("Other");
  });
});

describe("INDUSTRY_OPTIONS", () => {
  it("mirrors INDUSTRIES one-to-one", () => {
    expect(INDUSTRY_OPTIONS).toHaveLength(INDUSTRIES.length);
  });

  it("uses the industry string as both value and label", () => {
    // The select stores `value` straight into businesses.industry, so value must equal the
    // human-readable label — anything else would persist a code the CRM can't display.
    for (const opt of INDUSTRY_OPTIONS) {
      expect(opt.value).toBe(opt.label);
      expect(INDUSTRIES).toContain(opt.value);
    }
  });
});
