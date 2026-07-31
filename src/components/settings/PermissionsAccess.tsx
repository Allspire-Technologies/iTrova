import { useEffect, useState } from "react";
import Hint from "@/components/Hint";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, MoreHorizontal, Lock, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/ConfirmDialog";
import { PermissionMatrixEditor } from "./PermissionMatrixEditor";
import { DEFAULT_ROLE_PERMISSIONS, clonePermissionMap, type PermissionMap } from "@/lib/permissions";

// The new tables/RPC aren't in the generated Supabase types yet — cast once.
const sb = supabase;

type TeamRoleRow = { id: string; name: string; system_key: "manager" | "cashier" | null; permissions: PermissionMap };
type MemberRow = { user_id: string; app_role: "owner" | "manager" | "cashier"; name: string; email: string | null };
type AccessRow = { user_id: string; team_role_id: string | null; permissions: PermissionMap | null };

/** Settings → Permissions & Access: team roles (editable defaults + custom) and per-member access. */
export default function PermissionsAccess() {
  const { business, user, role, refresh } = useAuth();
  const isOwner = role === "owner";

  const [roles, setRoles] = useState<TeamRoleRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [access, setAccess] = useState<Record<string, AccessRow>>({});
  const [loaded, setLoaded] = useState(false);

  // Role editor state
  const [roleForm, setRoleForm] = useState<{ id?: string; system_key: "manager" | "cashier" | null; name: string; permissions: PermissionMap } | null>(null);
  // Member override editor state
  const [overrideForm, setOverrideForm] = useState<{ member: MemberRow; permissions: PermissionMap } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!business) return;
    const [{ data: tr }, { data: ma }, { data: ur }, { data: profs }, { data: emails }] = await Promise.all([
      sb.from("team_roles").select("id,name,system_key,permissions").eq("business_id", business.id).order("created_at"),
      sb.from("member_access").select("user_id,team_role_id,permissions").eq("business_id", business.id),
      sb.from("user_roles").select("user_id,role").eq("business_id", business.id),
      sb.from("profiles").select("id,owner_name"),
      sb.rpc("get_member_emails", { p_business_id: business.id }),
    ]);
    setRoles((tr ?? []) as TeamRoleRow[]);
    const accMap: Record<string, AccessRow> = {};
    for (const r of (ma ?? []) as AccessRow[]) accMap[r.user_id] = r;
    setAccess(accMap);
    const nameById: Record<string, string> = {};
    for (const p of (profs ?? []) as { id: string; owner_name: string | null }[]) if (p.owner_name) nameById[p.id] = p.owner_name;
    const emailById: Record<string, string> = {};
    for (const e of (emails ?? []) as { user_id: string; email: string }[]) emailById[e.user_id] = e.email;
    const rows = ((ur ?? []) as { user_id: string; role: MemberRow["app_role"] }[])
      .map((r) => ({ user_id: r.user_id, app_role: r.role, name: nameById[r.user_id] || emailById[r.user_id] || "Member", email: emailById[r.user_id] ?? null }))
      .sort((a, b) => (a.app_role === "owner" ? -1 : b.app_role === "owner" ? 1 : a.name.localeCompare(b.name)));
    setMembers(rows);
    setLoaded(true);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [business?.id]);

  const systemRow = (key: "manager" | "cashier") => roles.find((r) => r.system_key === key) ?? null;
  const customRoles = roles.filter((r) => !r.system_key);
  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? null;
  // A manager can't edit the system role of their own rank, roles assigned to them, or their own row.
  const managerLockedRole = (r: { system_key: string | null; id?: string }) =>
    !isOwner && ((r.system_key && r.system_key === role) || (r.id && access[user?.id ?? ""]?.team_role_id === r.id));

  /** The map a member effectively has right now (mirrors AuthContext resolution, sans plan cut). */
  const effectiveMapFor = (m: MemberRow): PermissionMap => {
    if (m.app_role === "owner") return {};
    const a = access[m.user_id];
    if (a?.permissions) return a.permissions;
    if (a?.team_role_id) { const r = roles.find((x) => x.id === a.team_role_id); if (r) return r.permissions; }
    const sys = systemRow(m.app_role as "manager" | "cashier");
    return sys?.permissions ?? DEFAULT_ROLE_PERMISSIONS[m.app_role as "manager" | "cashier"] ?? {};
  };

  // ---- role writes
  async function saveRole() {
    if (!business || !roleForm) return;
    if (!roleForm.system_key && !roleForm.name.trim()) return toast.error("Give the role a name");
    setBusy(true);
    try {
      if (roleForm.system_key) {
        const { error } = await sb.from("team_roles").upsert(
          { business_id: business.id, system_key: roleForm.system_key, name: roleForm.name, permissions: roleForm.permissions },
          { onConflict: "business_id,system_key" });
        if (error) throw error;
      } else if (roleForm.id) {
        const { error } = await sb.from("team_roles").update({ name: roleForm.name.trim(), permissions: roleForm.permissions }).eq("id", roleForm.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("team_roles").insert({ business_id: business.id, name: roleForm.name.trim(), permissions: roleForm.permissions });
        if (error) throw error;
      }
      toast.success("Role saved");
      setRoleForm(null);
      await load(); await refresh();
    } catch (e) { toast.error((e as { message?: string })?.message ?? "Couldn't save the role"); }
    finally { setBusy(false); }
  }

  function deleteCustomRole(r: TeamRoleRow) {
    const assigned = Object.values(access).filter((a) => a.team_role_id === r.id).length;
    if (assigned > 0) return toast.error(`Reassign ${assigned} member${assigned === 1 ? "" : "s"} off "${r.name}" first`);
    setConfirm({
      title: `Delete role "${r.name}"?`,
      description: "Members keep their base-role defaults after this role is removed.",
      onConfirm: async () => {
        const { error } = await sb.from("team_roles").delete().eq("id", r.id);
        if (error) return toast.error(error.message);
        toast.success("Role deleted"); await load(); await refresh();
      },
    });
  }

  function resetSystemRole(key: "manager" | "cashier") {
    const row = systemRow(key); if (!row) return;
    setConfirm({
      title: `Reset ${key === "manager" ? "Manager" : "Cashier"} to default?`,
      description: "The role goes back to the built-in permission set.",
      onConfirm: async () => {
        const { error } = await sb.from("team_roles").delete().eq("id", row.id);
        if (error) return toast.error(error.message);
        toast.success("Reset to default"); await load(); await refresh();
      },
    });
  }

  // ---- member writes
  async function assignRole(m: MemberRow, teamRoleId: string | null) {
    if (!business) return;
    // Assigning a role clears any per-member customization (the role becomes the source of truth).
    const { error } = await sb.from("member_access").upsert(
      { user_id: m.user_id, business_id: business.id, team_role_id: teamRoleId, permissions: null },
      { onConflict: "user_id,business_id" });
    if (error) return toast.error(error.message);
    toast.success("Role assigned — applies on their next sign-in or refresh");
    await load(); await refresh();
  }

  async function saveOverride() {
    if (!business || !overrideForm) return;
    setBusy(true);
    try {
      const a = access[overrideForm.member.user_id];
      const { error } = await sb.from("member_access").upsert(
        { user_id: overrideForm.member.user_id, business_id: business.id, team_role_id: a?.team_role_id ?? null, permissions: overrideForm.permissions },
        { onConflict: "user_id,business_id" });
      if (error) throw error;
      toast.success("Custom permissions saved — applies on their next sign-in or refresh");
      setOverrideForm(null);
      await load(); await refresh();
    } catch (e) { toast.error((e as { message?: string })?.message ?? "Couldn't save permissions"); }
    finally { setBusy(false); }
  }

  async function resetOverride(m: MemberRow) {
    if (!business) return;
    const a = access[m.user_id];
    const { error } = await sb.from("member_access").upsert(
      { user_id: m.user_id, business_id: business.id, team_role_id: a?.team_role_id ?? null, permissions: null },
      { onConflict: "user_id,business_id" });
    if (error) return toast.error(error.message);
    toast.success("Reset to role"); await load(); await refresh();
  }

  if (!loaded) return <p className="text-sm text-muted-foreground py-8 text-center">Loading permissions…</p>;

  return (
    <div className="space-y-6">
      {/* Team roles */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand"><ShieldCheck className="size-4" /></div>
              <div>
                <CardTitle className="font-display text-lg">Team roles</CardTitle>
                <CardDescription>What each role can see and do. Edit the defaults or create your own roles.</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setRoleForm({ system_key: null, name: "", permissions: {} })}><Plus className="size-4" /> New role</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Owner — immutable */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
            <div><p className="font-medium text-brand-dark">Owner</p><p className="text-xs text-muted-foreground">Full access to everything — can't be changed.</p></div>
            <Lock className="size-4 text-muted-foreground" aria-label="Locked" />
          </div>
          {/* System defaults */}
          {(["manager", "cashier"] as const).map((key) => {
            const row = systemRow(key);
            const label = key === "manager" ? "Manager" : "Cashier";
            const locked = managerLockedRole({ system_key: key });
            return (
              <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-dark">{label} <Badge variant={row ? "outline" : "secondary"} className="ml-1 align-middle">{row ? "Edited" : "Default"}</Badge></p>
                  <p className="text-xs text-muted-foreground">{key === "manager" ? "All operations except Team by default." : "POS and invoicing basics by default."}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Hint label={locked ? "You can't edit your own role" : undefined} wrap>
                    <Button variant="ghost" size="sm" disabled={locked}
                      onClick={() => setRoleForm({ system_key: key, name: label, permissions: clonePermissionMap(row?.permissions ?? DEFAULT_ROLE_PERMISSIONS[key]) })}>
                      <Pencil className="size-4" /> Edit
                    </Button>
                  </Hint>
                  {row && !locked && (
                    <Button variant="ghost" size="sm" onClick={() => resetSystemRole(key)}><RotateCcw className="size-4" /> Reset</Button>
                  )}
                </div>
              </div>
            );
          })}
          {/* Custom roles */}
          {customRoles.map((r) => {
            const locked = managerLockedRole(r);
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-dark">{r.name} <Badge variant="secondary" className="ml-1 align-middle">Custom</Badge></p>
                  <p className="text-xs text-muted-foreground">{Object.keys(r.permissions).length} module{Object.keys(r.permissions).length === 1 ? "" : "s"} granted</p>
                </div>
                <div className="flex items-center gap-1">
                  <Hint label={locked ? "You can't edit a role assigned to you" : undefined} wrap>
                    <Button variant="ghost" size="sm" disabled={locked}
                      onClick={() => setRoleForm({ id: r.id, system_key: null, name: r.name, permissions: clonePermissionMap(r.permissions) })}>
                      <Pencil className="size-4" /> Edit
                    </Button>
                  </Hint>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`More actions for ${r.name}`}><MoreHorizontal className="size-4" /> More</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={locked} onClick={() => deleteCustomRole(r)}>
                        <Trash2 className="size-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Members */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-brand-light grid place-items-center text-brand"><Users className="size-4" /></div>
            <div>
              <CardTitle className="font-display text-lg">Member permissions</CardTitle>
              <CardDescription>Attach a role to each member, or customize their access individually. Changes apply on their next sign-in or refresh.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => {
            const a = access[m.user_id];
            const isSelf = m.user_id === user?.id;
            const rowLocked = !isOwner && isSelf; // managers cannot change their own access
            const custom = !!a?.permissions;
            return (
              <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-dark truncate">{m.name}{isSelf ? " (you)" : ""}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.app_role === "owner" ? "Owner — full access" : (custom ? "Custom permissions" : (roleName(a?.team_role_id ?? null) ?? `${m.app_role === "manager" ? "Manager" : "Cashier"} (default)`))}
                    {m.email ? ` · ${m.email}` : ""}
                  </p>
                </div>
                {m.app_role !== "owner" && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {custom && <Badge variant="outline">Custom</Badge>}
                    <Hint label={rowLocked && isSelf ? "Managed by the owner" : undefined} wrap>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-base md:text-sm disabled:opacity-60"
                        disabled={rowLocked}
                        value={a?.team_role_id ?? ""}
                        onChange={(e) => assignRole(m, e.target.value || null)}
                        aria-label={`Role for ${m.name}`}
                      >
                        <option value="">{m.app_role === "manager" ? "Manager (default)" : "Cashier (default)"}</option>
                        {customRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </Hint>
                    <Button variant="ghost" size="sm" disabled={rowLocked}
                      onClick={() => setOverrideForm({ member: m, permissions: clonePermissionMap(effectiveMapFor(m)) })}>
                      <Pencil className="size-4" /> Customize
                    </Button>
                    {custom && !rowLocked && (
                      <Button variant="ghost" size="sm" onClick={() => resetOverride(m)}><RotateCcw className="size-4" /> Reset</Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {members.length === 0 && <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">No team members yet — invite them from the Team page.</p>}
        </CardContent>
      </Card>

      {/* Role editor dialog */}
      <Dialog open={!!roleForm} onOpenChange={(o) => !o && setRoleForm(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle>{roleForm?.system_key ? `Edit ${roleForm.name} defaults` : roleForm?.id ? "Edit role" : "New role"}</DialogTitle></DialogHeader>
          {roleForm && (
            <div className="space-y-3">
              {!roleForm.system_key && (
                <div className="space-y-2">
                  <Label>Role name</Label>
                  <Input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} placeholder="e.g. Storekeeper" />
                </div>
              )}
              <div className="space-y-2">
                <Label>Permissions</Label>
                <PermissionMatrixEditor value={roleForm.permissions} onChange={(p) => setRoleForm({ ...roleForm, permissions: p })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleForm(null)}>Cancel</Button>
            <Button variant="brand" onClick={saveRole} disabled={busy}>Save role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member override dialog */}
      <Dialog open={!!overrideForm} onOpenChange={(o) => !o && setOverrideForm(null)}>
        <DialogContent variant="wide">
          <DialogHeader><DialogTitle>Customize access — {overrideForm?.member.name}</DialogTitle></DialogHeader>
          {overrideForm && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Starts from their current role. Saving makes this member "Custom" — role changes won't affect them until you reset.</p>
              <PermissionMatrixEditor value={overrideForm.permissions} onChange={(p) => setOverrideForm({ ...overrideForm, permissions: p })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideForm(null)}>Cancel</Button>
            <Button variant="brand" onClick={saveOverride} disabled={busy}>Save permissions</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel="Confirm" onConfirm={() => confirm?.onConfirm()} />
    </div>
  );
}
