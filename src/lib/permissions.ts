import { canAccessModule } from "@/lib/moduleAccess";

// Permissions & Access (RBAC v1). Permissions are a module×action map resolved client-side:
//   owner → everything; else member override ?? assigned role map ?? code defaults, intersected
//   with the plan's modules. A business that never touches the feature resolves purely from
//   DEFAULT_ROLE_PERMISSIONS — byte-for-byte today's behavior.

// Local union to avoid an import cycle with AuthContext.
export type AppRoleKey = "owner" | "manager" | "cashier";
export type PermissionMap = Record<string, string[]>;

export type ActionDef = { key: string; label: string };
export type ModuleDef = { key: string; label: string; actions: ActionDef[] };

const a = (key: string, label: string): ActionDef => ({ key, label });

/** The permission registry: every gateable module and its actions. Dashboard/Settings are not here —
 *  they're always visible (Settings keeps its own owner-only cards). */
export const MODULE_ACTIONS: ModuleDef[] = [
  { key: "inventory", label: "Inventory", actions: [
    a("view", "View"), a("create", "Add products"), a("edit", "Edit products"),
    a("adjust_stock", "Adjust stock"), a("csv_import", "Import CSV"), a("csv_export", "Export CSV"),
  ]},
  { key: "pos", label: "Point of Sale", actions: [
    a("view", "Sell (checkout)"), a("orders_manage", "Manage orders"), a("orders_delete", "Delete orders"),
    a("eod_report", "End-of-day report"), a("review_offline", "Review offline sales"),
  ]},
  { key: "suppliers", label: "Suppliers", actions: [
    a("view", "View"), a("create", "Add suppliers"), a("edit", "Edit suppliers"),
    a("delete", "Delete suppliers"), a("csv_import", "Import CSV"), a("csv_export", "Export CSV"),
  ]},
  { key: "raw_materials", label: "Raw Materials", actions: [
    a("view", "View"), a("create", "Add materials"), a("edit", "Edit materials"),
    a("record_purchase", "Record purchases"), a("adjust_stock", "Adjust stock"),
    a("link_product", "Link to product"), a("reorder", "Reorder via WhatsApp"),
    a("approve_requests", "Approve material requests"), a("reject_requests", "Reject material requests"),
    a("csv_import", "Import CSV"), a("csv_export", "Export CSV"),
  ]},
  { key: "invoices", label: "Invoices", actions: [
    a("view", "View"), a("create", "Create invoices"), a("edit", "Edit invoices"),
    a("status_change", "Change status"), a("record_payment", "Record payments"),
    a("delete", "Delete invoices"), a("print", "Print receipt"), a("download", "Download PDF"),
    a("csv_export", "Export CSV"),
  ]},
  { key: "export_invoices", label: "Export Invoices", actions: [
    a("view", "View"), a("create", "Create"), a("edit", "Edit"), a("delete", "Delete"),
    a("download", "Download PDF/DOCX"),
  ]},
  { key: "purchase_orders", label: "Purchase Orders", actions: [
    a("view", "View"), a("create", "Create POs"), a("status_change", "Change status"),
    a("receive", "Receive stock"), a("delete", "Delete POs"), a("download", "Download PDF"),
    a("csv_import", "Import CSV"), a("csv_export", "Export CSV"),
  ]},
  { key: "general_store", label: "General Store", actions: [
    a("view", "View"), a("item_manage", "Manage items"), a("item_delete", "Delete items"),
    a("staff_manage", "Manage staff"), a("staff_delete", "Delete staff"),
    a("checkout", "Give out items"), a("return", "Record returns"), a("csv_import", "Import CSV"),
  ]},
  // Production is Request → Run only. Linking materials to a product ("Link to product") lives on
  // the Raw Materials page (raw_materials.link_product), and approving/rejecting material requests
  // belongs to the raw-materials custodian (raw_materials.approve_requests/reject_requests):
  // requests flow FROM production TO whoever manages raw-material stock.
  { key: "production", label: "Production", actions: [
    a("view", "View"), a("request", "Request materials"), a("produce", "Record production"),
  ]},
  { key: "expenditure", label: "Expenditure", actions: [
    a("view", "View"), a("create", "Add expenses"), a("edit", "Edit expenses"),
    a("delete", "Delete expenses"), a("export", "Download PDF"),
    a("csv_import", "Import CSV"), a("csv_export", "Export CSV"),
  ]},
  { key: "reports", label: "Reports", actions: [a("view", "View"), a("export", "Export")] },
  { key: "accounting", label: "Accounting", actions: [a("view", "View"), a("export", "Export"), a("manage", "Post journals & manage accounts")] },
  { key: "assets", label: "Assets", actions: [a("view", "View"), a("create", "Add assets"), a("edit", "Edit assets"), a("delete", "Delete assets"), a("depreciate", "Run depreciation")] },
  { key: "team", label: "Team", actions: [
    a("view", "View"), a("invite", "Invite members"), a("role_change", "Change roles"),
    a("remove", "Remove members"), a("csv_import", "Import CSV"), a("csv_export", "Export CSV"),
  ]},
];

const REGISTRY_KEYS = new Set(MODULE_ACTIONS.map((m) => m.key));
const allActions = (key: string): string[] => MODULE_ACTIONS.find((m) => m.key === key)?.actions.map((x) => x.key) ?? [];

/** Code defaults mirroring pre-RBAC behavior exactly. Manager: everything except Team and the
 *  owner-only bits (export-invoice edit/delete, general-store deletes). Cashier: POS + invoices
 *  view/create. These apply whenever a business hasn't edited its defaults. */
export const DEFAULT_ROLE_PERMISSIONS: Record<"manager" | "cashier", PermissionMap> = {
  manager: {
    inventory: allActions("inventory"),
    pos: allActions("pos"),
    suppliers: allActions("suppliers"),
    raw_materials: allActions("raw_materials"),
    invoices: allActions("invoices"),
    export_invoices: ["view", "create", "download"],
    purchase_orders: allActions("purchase_orders"),
    general_store: ["view", "item_manage", "staff_manage", "checkout", "return", "csv_import"],
    production: allActions("production"),
    expenditure: allActions("expenditure"),
    reports: ["view", "export"],
    accounting: ["view", "export", "manage"],
    assets: allActions("assets"),
  },
  cashier: {
    pos: ["view", "orders_manage"],
    invoices: ["view", "create", "print"], // cashiers print receipts every sale
  },
};

export type ResolvedPermissions = {
  /** Registry modules the member can see (nav/routes) — already plan-intersected. */
  modules: string[];
  can: (module: string, action: string) => boolean;
};

export function resolvePermissions(input: {
  appRole: AppRoleKey | string | null;
  roleMap: PermissionMap | null;
  override: PermissionMap | null;
  planModules: string[] | null;
}): ResolvedPermissions {
  const { appRole, roleMap, override, planModules } = input;
  const planOk = (m: string) => canAccessModule(planModules, m);

  if (appRole === "owner") {
    return {
      modules: MODULE_ACTIONS.map((m) => m.key).filter(planOk),
      can: (m) => planOk(m),
    };
  }
  if (!appRole) return { modules: [], can: () => false };

  const defaults = DEFAULT_ROLE_PERMISSIONS[appRole as "manager" | "cashier"] ?? {};
  const effective: PermissionMap = override ?? roleMap ?? defaults;

  return {
    modules: MODULE_ACTIONS.map((m) => m.key).filter((k) => (effective[k]?.length ?? 0) > 0 && planOk(k)),
    can: (m, action) => {
      if (!planOk(m)) return false;
      if (!REGISTRY_KEYS.has(m)) return true; // non-permission modules (e.g. insights) keep today's behavior
      return effective[m]?.includes(action) ?? false;
    },
  };
}

// ---------------------------------------------------------------- editor helpers
/** Deep-clone a permission map (for seeding the matrix editor). */
export function clonePermissionMap(map: PermissionMap): PermissionMap {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
}

/** Toggle one action; unchecking `view` clears the module, checking anything ensures `view`. */
export function toggleAction(map: PermissionMap, module: string, action: string): PermissionMap {
  const next = clonePermissionMap(map);
  const cur = new Set(next[module] ?? []);
  if (cur.has(action)) {
    cur.delete(action);
    if (action === "view") cur.clear();
  } else {
    cur.add(action);
    cur.add("view");
  }
  if (cur.size === 0) delete next[module];
  else next[module] = allActions(module).filter((x) => cur.has(x));
  return next;
}

/** Toggle a whole module on (all actions) or off. */
export function toggleModule(map: PermissionMap, module: string): PermissionMap {
  const next = clonePermissionMap(map);
  if ((next[module]?.length ?? 0) > 0) delete next[module];
  else next[module] = allActions(module);
  return next;
}
