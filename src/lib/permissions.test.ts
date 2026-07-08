import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";
import { resolvePermissions, toggleAction, toggleModule, DEFAULT_ROLE_PERMISSIONS, MODULE_ACTIONS } from "./permissions";

const resolve = (over: Partial<Parameters<typeof resolvePermissions>[0]> = {}) =>
  resolvePermissions({ appRole: "manager", roleMap: null, override: null, planModules: null, ...over });

describe("resolvePermissions — owner", () => {
  it("owner can do everything the plan permits", () => {
    const r = resolve({ appRole: "owner" });
    expect(r.can("invoices", "delete")).toBe(true);
    expect(r.can("team", "remove")).toBe(true);
    expect(r.modules).toEqual(MODULE_ACTIONS.map((m) => m.key));
  });
  it("plan intersection still hides non-plan modules from the owner", () => {
    const r = resolve({ appRole: "owner", planModules: ["pos", "invoices"] });
    expect(r.can("inventory", "view")).toBe(false);
    expect(r.modules).toEqual(["pos", "invoices"]);
  });
});

describe("resolvePermissions — defaults pin today's behavior", () => {
  it("manager: full invoices/pos, no team, no owner-only bits", () => {
    const r = resolve({ appRole: "manager" });
    expect(r.can("invoices", "delete")).toBe(true);
    expect(r.can("pos", "eod_report")).toBe(true);
    expect(r.can("team", "view")).toBe(false);
    expect(r.can("export_invoices", "edit")).toBe(false);
    expect(r.can("export_invoices", "create")).toBe(true);
    expect(r.can("general_store", "item_delete")).toBe(false);
    expect(r.can("general_store", "item_manage")).toBe(true);
  });
  it("cashier: pos sell/orders + invoices view/create only", () => {
    const r = resolve({ appRole: "cashier" });
    expect(r.can("pos", "view")).toBe(true);
    expect(r.can("pos", "orders_manage")).toBe(true);
    expect(r.can("pos", "orders_delete")).toBe(false);
    expect(r.can("invoices", "create")).toBe(true);
    expect(r.can("invoices", "edit")).toBe(false);
    expect(r.can("inventory", "view")).toBe(false);
    expect(r.modules).toEqual(["pos", "invoices"]);
  });
  it("null role denies everything", () => {
    const r = resolve({ appRole: null });
    expect(r.can("pos", "view")).toBe(false);
    expect(r.modules).toEqual([]);
  });
});

describe("resolvePermissions — precedence", () => {
  it("assigned role map beats defaults", () => {
    const r = resolve({ appRole: "cashier", roleMap: { inventory: ["view"] } });
    expect(r.can("inventory", "view")).toBe(true);
    expect(r.can("pos", "view")).toBe(false); // role map replaces defaults entirely
  });
  it("member override beats the role map", () => {
    const r = resolve({ appRole: "cashier", roleMap: { inventory: ["view"] }, override: { reports: ["view"] } });
    expect(r.can("reports", "view")).toBe(true);
    expect(r.can("inventory", "view")).toBe(false);
  });
  it("an empty override object is deny-all (distinct from null)", () => {
    const r = resolve({ appRole: "manager", override: {} });
    expect(r.can("invoices", "view")).toBe(false);
    expect(r.modules).toEqual([]);
  });
});

describe("resolvePermissions — plan + registry edges", () => {
  it("a granted module still hides when the plan lacks it", () => {
    const r = resolve({ appRole: "manager", planModules: ["pos"] });
    expect(r.can("inventory", "view")).toBe(false);
    expect(r.can("pos", "view")).toBe(true);
  });
  it("non-registry modules stay role-free (nav parity for e.g. insights)", () => {
    const r = resolve({ appRole: "cashier" });
    expect(r.can("insights", "view")).toBe(true);
  });
});

describe("server/client defaults drift guard", () => {
  it("the SQL default_role_permissions JSON matches DEFAULT_ROLE_PERMISSIONS exactly", () => {
    // Server-side enforcement (has_permission) embeds the same defaults in SQL. This test parses the
    // LATEST migration that re-declares default_role_permissions so the two can never drift silently.
    // (Superseded declarations: 20260704150000 → 20260707110000 → 20260707150000 → 20260707190000 → 20260708110000.)
    const sql = readFileSync(resolvePath(__dirname, "../../supabase/migrations/20260708110000_expenditure_rbac.sql"), "utf8");
    const block = sql.split("RBAC_DEFAULTS_JSON_START")[1]?.split("RBAC_DEFAULTS_JSON_END")[0] ?? "";
    const grab = (role: string) => {
      const m = block.match(new RegExp(`when '${role}' then '([\\s\\S]*?)'::jsonb`));
      expect(m, `missing ${role} defaults in migration`).toBeTruthy();
      return JSON.parse(m![1]);
    };
    expect(grab("manager")).toEqual(DEFAULT_ROLE_PERMISSIONS.manager);
    expect(grab("cashier")).toEqual(DEFAULT_ROLE_PERMISSIONS.cashier);
  });
});

describe("registry completeness — every can() call is a registered permission", () => {
  // Modules gated by can() but deliberately NOT in MODULE_ACTIONS: `insights` is the "AI Insights —
  // Soon" placeholder, which resolvePermissions grants by parity until it launches. Add a module
  // here only with the same explicit intent.
  const NON_REGISTRY_MODULES = new Set(["insights"]);

  function collectSourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectSourceFiles(full, acc);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  }

  it("no can(\"module\",\"action\") in src/ references an action missing from Permissions", () => {
    const files = collectSourceFiles(resolvePath(__dirname, ".."));
    const CALL = /\bcan\(\s*["']([a-z_]+)["']\s*,\s*["']([a-z_]+)["']\s*\)/g;
    const byModule = new Map(MODULE_ACTIONS.map((m) => [m.key, new Set(m.actions.map((x) => x.key))]));
    const missing: string[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CALL)) {
        const pair = `${m[1]}.${m[2]}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (NON_REGISTRY_MODULES.has(m[1])) continue;
        if (!byModule.get(m[1])?.has(m[2])) missing.push(`${pair}  (${file.replace(/.*[/\\]src[/\\]/, "src/")})`);
      }
    }
    expect(missing, `can() calls whose action isn't registered in MODULE_ACTIONS:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("editor helpers", () => {
  it("toggleAction adds view implicitly and clears the module when view is removed", () => {
    let m = toggleAction({}, "inventory", "edit");
    expect(m.inventory).toEqual(["view", "edit"]);
    m = toggleAction(m, "inventory", "view");
    expect(m.inventory).toBeUndefined();
  });
  it("toggleModule flips between all actions and none", () => {
    const on = toggleModule({}, "reports");
    expect(on.reports).toEqual(["view", "export"]);
    expect(toggleModule(on, "reports").reports).toBeUndefined();
  });
  it("manager defaults contain every inventory action (sanity vs registry drift)", () => {
    const inv = MODULE_ACTIONS.find((m) => m.key === "inventory")!;
    expect(DEFAULT_ROLE_PERMISSIONS.manager.inventory).toEqual(inv.actions.map((x) => x.key));
  });
});
