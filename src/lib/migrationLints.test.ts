import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Lints over the migration files themselves, for mistakes that type-checking can't see and that
// have actually bitten production. Historical files that already shipped the mistake are
// allowlisted — they're applied history and can't be edited — so only a NEW occurrence fails.

const MIGRATIONS_DIR = join(__dirname, "../../supabase/migrations");

describe("migration lints", () => {
  // record "new" has no field "sale_id" — twice now (20260726110000 fixed it, 20260814100000
  // reintroduced it, 20260826100000 fixed it again). SQL does not guarantee short-circuit
  // evaluation, so a shared trigger function must never reference a table-specific NEW field in
  // the same expression as its TG_TABLE_NAME check; the field access belongs INSIDE a block that
  // TG_TABLE_NAME alone decides to enter.
  it("no compound TG_TABLE_NAME + NEW.<field> expressions in shared trigger functions", () => {
    const knownBad = new Set([
      "20260726100000_server_plan_limits.sql",   // the original bug, already applied
      "20260814100000_plan_limits_expiry_and_gaps.sql", // the regression, already applied
    ]);
    const flat = /tg_table_name\s*(?:=|<>|!=)\s*'[a-z_]+'\s+and\s+new\./i;
    const offenders: string[] = [];
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
      if (knownBad.has(f)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      for (const line of sql.split("\n")) {
        const code = line.split("--")[0]; // ignore comments (this rule is DOCUMENTED in comments)
        if (flat.test(code)) { offenders.push(`${f}: ${line.trim()}`); break; }
      }
    }
    expect(offenders, "nest the NEW.<field> access inside an `if TG_TABLE_NAME = '…' then` block — see 20260826100000").toEqual([]);
  });
});
