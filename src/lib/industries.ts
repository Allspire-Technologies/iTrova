// Curated list of industries/sectors a business can pick at signup or in Settings.
// Stored verbatim in businesses.industry; the Admin OS segments customers by these values,
// so keep them stable. Add new ones at the end rather than renaming existing entries.
export const INDUSTRIES = [
  "Retail / General Trade",
  "Supermarket / Grocery",
  "Fashion & Apparel",
  "Food & Beverage",
  "Restaurant / Hospitality",
  "Health & Beauty / Cosmetics",
  "Pharmacy",
  "Electronics & Gadgets",
  "Building & Hardware",
  "Automotive & Spare Parts",
  "Furniture & Home",
  "Agriculture & Agro-processing",
  "Manufacturing",
  "Wholesale / Distribution",
  "Services",
  "Other",
] as const;

export const INDUSTRY_OPTIONS = INDUSTRIES.map((s) => ({ value: s, label: s }));
