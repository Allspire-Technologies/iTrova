import { useEffect, useRef, useState } from "react";
import { TeamMembersSkeleton } from "@/components/Skeletons";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, Copy, Trash2, Users, TrendingUp, Search, Download, Upload, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import Paginator, { usePagination } from "@/components/Paginator";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";

type Member = { user_id: string; role: AppRole; owner_name: string | null; last_seen: string | null; email: string | null };
type Invitation = {
  id: string; email: string; role: AppRole; token: string;
  expires_at: string; accepted_at: string | null; created_at: string;
};

const ROLE_LABEL: Record<AppRole, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier" };
const ROLE_DESC: Record<AppRole, string> = {
  owner: "Full access including team and settings",
  manager: "All operations except team and settings",
  cashier: "Point of Sale and Dashboard only",
};

export default function Team() {
  const { business, user, hasModule, can } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("cashier");
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [salesByStaff, setSalesByStaff] = useState<Record<string, { total: number; count: number }>>({});
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const tier = business?.subscription_tier;
  const staffLimit = getLimit(tier, "staff");
  const atStaffLimit = isAtLimit(members.length, tier, "staff");

  const formatLastSeen = (ts: string | null) => {
    if (!ts) return "Never logged in";
    const d = new Date(ts);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (diffDays === 0) return "Active today";
    if (diffDays === 1) return "Active yesterday";
    if (diffDays < 7) return `Active ${diffDays} days ago`;
    return `Last seen ${fmtDate(ts)}`;
  };

  const load = async () => {
    if (!business) return;
    setLoading(true);
    const [{ data: roles }, { data: invs }, { data: salesData }, { data: emailData }] = await Promise.all([
      supabase.from("user_roles").select("user_id, role").eq("business_id", business.id),
      supabase.from("invitations").select("*").eq("business_id", business.id).order("created_at", { ascending: false }),
      supabase.from("sales").select("staff_id, total_amount").eq("business_id", business.id).eq("voided", false),
      supabase.rpc("get_member_emails", { p_business_id: business.id }),
    ]);
    const userIds = Array.from(new Set((roles || []).map(r => r.user_id)));
    let profiles: Record<string, string> = {};
    let lastSeenMap: Record<string, string | null> = {};
    if (userIds.length) {
      const { data: ps } = await supabase.from("profiles").select("id, owner_name, last_seen").in("id", userIds);
      profiles = Object.fromEntries((ps || []).map(p => [p.id, p.owner_name]));
      lastSeenMap = Object.fromEntries((ps || []).map(p => [p.id, (p as any).last_seen ?? null]));
    }
    const emailMap: Record<string, string> = Object.fromEntries(
      ((emailData as { user_id: string; email: string }[]) || []).map(e => [e.user_id, e.email])
    );
    const salesMap: Record<string, { total: number; count: number }> = {};
    for (const s of (salesData || []) as { staff_id: string | null; total_amount: number }[]) {
      if (!s.staff_id) continue;
      if (!salesMap[s.staff_id]) salesMap[s.staff_id] = { total: 0, count: 0 };
      salesMap[s.staff_id].total += Number(s.total_amount);
      salesMap[s.staff_id].count += 1;
    }
    setSalesByStaff(salesMap);
    setMembers(((roles as { user_id: string; role: AppRole }[]) || []).map(r => ({
      user_id: r.user_id, role: r.role, owner_name: profiles[r.user_id] || null,
      last_seen: lastSeenMap[r.user_id] ?? null,
      email: emailMap[r.user_id] || null,
    })));
    setInvites((invs as Invitation[]) || []);
    setLoading(false);
  };

  useEffect(() => { load();   }, [business?.id]);

  const sendInvite = async () => {
    if (!business || !inviteEmail) return;
    if (isAtLimit(members.length, business.subscription_tier, "staff")) {
      toast.error(limitMessage("staff"));
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("invitations").insert({
      business_id: business.id,
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole,
      invited_by: user?.id,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Invitation created — copy the link to share");
    setInviteEmail(""); setInviteRole("cashier"); setInviteOpen(false);
    load();
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/accept-invite?token=${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  };

  const revoke = (id: string) => {
    setPending({
      title: "Revoke invitation?",
      description: "The invite link will be deactivated. You can create a new one at any time.",
      onConfirm: async () => {
        const { error } = await supabase.from("invitations").delete().eq("id", id);
        if (error) { toast.error(error.message); return; }
        toast.success("Invitation revoked"); load();
      },
    });
  };

  const changeRole = async (m: Member, next: AppRole) => {
    if (!business) return;
    if (m.user_id === user?.id) { toast.error("You can't change your own role"); return; }
    const { error: delErr } = await supabase.from("user_roles")
      .delete().eq("user_id", m.user_id).eq("business_id", business.id);
    if (delErr) { toast.error(delErr.message); return; }
    const { error } = await supabase.from("user_roles").insert({
      user_id: m.user_id, business_id: business.id, role: next,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Role updated to ${ROLE_LABEL[next]}`); load();
  };

  const deactivateMember = (m: Member) => {
    if (!business) return;
    if (m.user_id === user?.id) { toast.error("You can't deactivate yourself"); return; }
    setPending({
      title: `Remove ${m.owner_name || "this member"}?`,
      description: "They will immediately lose access to this business. Their sales history and data are preserved.",
      onConfirm: async () => {
        // RPC (not a raw user_roles delete): also clears their profiles.business_id so access is
        // actually revoked — data RLS is gated on that, not on the role row.
        const { error } = await supabase.rpc("remove_member", { _user_id: m.user_id });
        if (error) { toast.error(error.message); return; }
        toast.success("Member removed"); load();
      },
    });
  };

  const filteredMembers = members.filter(m =>
    (roleFilter === "all" || m.role === roleFilter) &&
    (!q || (m.owner_name || "").toLowerCase().includes(q.toLowerCase()))
  );
  const { paged: pagedMembers, page: memPage, setPage: setMemPage, pageSize: memPageSize,
    setPageSize: setMemPageSize, pageCount: memPageCount, total: memTotal } = usePagination(filteredMembers, 10);

  const downloadTemplate = () => {
    downloadCsv("team-template.csv", ["email,role", "adaeze@example.com,cashier"].join("\n"));
    toast.success("Template downloaded");
  };

  const exportMembers = () => {
    if (members.length === 0) return;
    const rows = members.map(m => ({
      name: m.owner_name || "",
      email: m.email || "",
      role: m.role,
      total_sales: salesByStaff[m.user_id]?.total || 0,
      sale_count: salesByStaff[m.user_id]?.count || 0,
      last_seen: m.last_seen ? fmtDate(m.last_seen) : "Never",
    }));
    downloadCsv(
      `team-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, ["name", "email", "role", "total_sales", "sale_count", "last_seen"])
    );
    toast.success(`Exported ${rows.length} member${rows.length === 1 ? "" : "s"}`);
  };

  const importCsv = async (file: File) => {
    if (!business) return;
    if (isAtLimit(members.length, business.subscription_tier, "staff")) {
      toast.error(limitMessage("staff"));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const valid = rows.filter(r =>
        r.email?.trim() && ["manager", "cashier"].includes((r.role || "").trim().toLowerCase())
      );
      if (valid.length === 0)
        return toast.error("No valid rows. Required columns: email, role (manager or cashier)");
      let created = 0;
      for (const r of valid) {
        const { error } = await supabase.from("invitations").insert({
          business_id: business.id,
          email: r.email.trim().toLowerCase(),
          role: r.role.trim().toLowerCase() as AppRole,
          invited_by: user?.id,
        });
        if (!error) created++;
      }
      if (created > 0) { toast.success(`Created ${created} invitation${created === 1 ? "" : "s"}`); load(); }
      else toast.error("No invitations could be created");
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark flex items-center gap-2">
            <Users className="size-7" /> Team
          </h1>
          <p className="text-muted-foreground mt-1">Invite staff and decide what each person can do.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          {can("team", "invite") && hasModule("csv_import") && <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atStaffLimit} title={atStaffLimit ? limitMessage("staff") : undefined}><Upload className="size-4" /> Import CSV</Button>}
          <Button variant="outline" onClick={exportMembers} disabled={members.length === 0}><Download className="size-4" /> Export</Button>
          {staffLimit !== null && members.length >= Math.floor(staffLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atStaffLimit ? "text-destructive" : "text-amber-600"}`}>
              {members.length} / {staffLimit} seats
            </span>
          )}
          {can("team", "invite") && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button variant="hero" disabled={atStaffLimit} title={atStaffLimit ? limitMessage("staff") : undefined}><UserPlus className="size-4" /> Invite teammate</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite a teammate</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="name@example.com"
                  value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
              </div>
              <div>
                <Label>Role</Label>
                <SearchableSelect
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as AppRole)}
                  options={[
                    { value: "manager", label: `Manager — ${ROLE_DESC.manager}` },
                    { value: "cashier", label: `Cashier — ${ROLE_DESC.cashier}` },
                  ]}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                After creating the invite, copy the link and send it to your teammate. They'll sign up with that exact email to join.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button onClick={sendInvite} disabled={submitting || !inviteEmail}>Create invite</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
          )}
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 shadow-card border-border/60">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => { setQ(e.target.value); setMemPage(1); }}
            placeholder="Search by name" className="pl-9" />
        </div>
        <SearchableSelect
          value={roleFilter}
          onValueChange={v => { setRoleFilter(v); setMemPage(1); }}
          className="w-40"
          options={[
            { value: "all", label: "All roles" },
            { value: "owner", label: "Owner" },
            { value: "manager", label: "Manager" },
            { value: "cashier", label: "Cashier" },
          ]}
        />
        <div className="text-sm text-muted-foreground self-center">{filteredMembers.length} of {members.length}</div>
      </Card>

      <Card className="shadow-card border-border/60">
        <CardHeader><CardTitle className="font-display text-lg">Members</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading && <TeamMembersSkeleton />}
          {!loading && filteredMembers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {members.length === 0 ? "No members yet." : "No members match your search."}
            </p>
          )}
          {pagedMembers.map(m => {
            const stats = salesByStaff[m.user_id];
            return (
            <div key={m.user_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {m.owner_name || "Unnamed"} {m.user_id === user?.id && <span className="text-xs text-muted-foreground">(you)</span>}
                </div>
                {m.email && <div className="text-xs text-muted-foreground truncate">{m.email}</div>}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>
                  {stats ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <TrendingUp className="size-3 text-brand" />
                      <span className="font-medium text-foreground">{fmt(stats.total)}</span>
                      <span>· {stats.count} sale{stats.count !== 1 ? "s" : ""}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No sales yet</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{formatLastSeen(m.last_seen)}</div>
              </div>
              <div className="flex items-center gap-2">
                {m.role !== "owner" && m.user_id !== user?.id && (
                  <>
                    {can("team", "role_change") && (
                    <SearchableSelect
                      value={m.role}
                      onValueChange={(v) => changeRole(m, v as AppRole)}
                      className="w-36"
                      options={[
                        { value: "manager", label: "Manager" },
                        { value: "cashier", label: "Cashier" },
                      ]}
                    />
                    )}
                    {can("team", "remove") && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`More actions for ${m.owner_name || m.email || "member"}`}><MoreHorizontal className="size-4" /> More</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deactivateMember(m)}><Trash2 className="size-4 mr-2" /> Remove member</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </>
                )}
              </div>
            </div>
          );})}
          {memPageCount > 1 && (
            <Paginator page={memPage} pageCount={memPageCount} pageSize={memPageSize}
              total={memTotal} onPageChange={setMemPage} onPageSizeChange={setMemPageSize} />
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card border-border/60">
        <CardHeader><CardTitle className="font-display text-lg">Pending invitations</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {invites.filter(i => !i.accepted_at).length === 0 && (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          )}
          {invites.filter(i => !i.accepted_at).map(i => {
            const expired = new Date(i.expires_at) < new Date();
            return (
              <div key={i.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium truncate">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_LABEL[i.role]} · {expired ? "expired" : `expires ${fmtDate(i.expires_at)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyLink(i.token)} disabled={expired}>
                    <Copy className="size-3.5" /> Copy link
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => revoke(i.id)} aria-label="Revoke">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.title ?? ""}
        description={pending?.description}
        confirmLabel="Confirm"
        onConfirm={pending?.onConfirm ?? (() => {})}
      />
    </div>
  );
}
