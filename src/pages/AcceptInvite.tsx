import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Clock, LogOut } from "lucide-react";
import { toast } from "sonner";

type InviteState = { status: string; business_name: string | null; email: string | null; role: string | null };
type Status = "idle" | "working" | "done" | "error" | "wrong-account" | "used" | "expired" | "other-business";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invite, setInvite] = useState<{ business: string; role: string } | null>(null);
  const attempted = useRef(""); // accept runs once per token (refresh() changes identity → don't loop)

  useEffect(() => {
    if (loading) return;
    if (!token) { setStatus("error"); setMessage("No invitation token provided."); return; }
    if (!user) {
      sessionStorage.setItem("pending_invite_token", token);
      navigate(`/invite-auth?token=${encodeURIComponent(token)}`, { replace: true });
      return;
    }
    if (attempted.current === token) return;
    attempted.current = token;
    (async () => {
      setStatus("working");

      // Resolve the precise invite status first so used/expired get their own screens.
      const { data } = await supabase.rpc("get_invite_state", { _token: token });
      const st = (data as InviteState[] | null)?.[0];
      if (st?.status === "used") { setStatus("used"); return; }
      if (st?.status === "expired") { setStatus("expired"); return; }
      if (!st || st.status === "not_found") { setStatus("error"); setMessage("This invitation link is invalid."); return; }

      setInvite({ business: st.business_name ?? "the team", role: st.role ?? "" });
      if (st.email && user.email && st.email.toLowerCase() !== user.email.toLowerCase()) {
        setInviteEmail(st.email);
        setStatus("wrong-account");
        return;
      }

      const { error } = await supabase.rpc("accept_invitation", { _token: token });
      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("already used")) { setStatus("used"); return; }
        if (m.includes("expired")) { setStatus("expired"); return; }
        if (m.includes("already belongs")) { setStatus("other-business"); return; }
        if (m.includes("email") && m.includes("match")) { setInviteEmail(st.email ?? ""); setStatus("wrong-account"); return; }
        setStatus("error"); setMessage(error.message);
        return;
      }
      sessionStorage.removeItem("pending_invite_token");
      await refresh();
      setStatus("done");
      toast.success("You've joined the team!");
    })();
  }, [loading, user, token, navigate, refresh]);

  // Gently send the new teammate to their dashboard after they've seen the success screen.
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(() => navigate("/", { replace: true }), 5000);
    return () => clearTimeout(t);
  }, [status, navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate(`/invite-auth?token=${encodeURIComponent(token)}`, { replace: true });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-soft p-4">
      <Card className="max-w-md w-full shadow-card border-border/60">
        <CardContent className="p-8 text-center space-y-4">
          {status === "working" && (
            <>
              <Loader2 className="size-10 mx-auto animate-spin text-brand" />
              <p className="font-medium">Joining the team…</p>
            </>
          )}

          {status === "done" && (
            <>
              <CheckCircle2 className="size-12 mx-auto text-brand" />
              <h1 className="font-display text-2xl font-bold text-brand-dark">You're in! 🎉</h1>
              <p className="text-sm text-muted-foreground">
                You've joined <span className="font-medium text-foreground">{invite?.business ?? "the team"}</span>
                {invite?.role ? <> as a <span className="font-medium text-foreground capitalize">{invite.role}</span></> : null}.
              </p>
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>Go to your dashboard</Button>
              <p className="text-xs text-muted-foreground">Taking you there automatically…</p>
            </>
          )}

          {status === "wrong-account" && (
            <>
              <XCircle className="size-10 mx-auto text-warning" />
              <p className="font-medium">Wrong account</p>
              <p className="text-sm text-muted-foreground">
                This invitation was sent to <span className="font-medium text-foreground">{inviteEmail}</span>,
                but you're signed in as <span className="font-medium text-foreground">{user?.email}</span>.
              </p>
              <p className="text-sm text-muted-foreground">Sign out and use the correct account to accept this invite.</p>
              <Button onClick={handleLogout} className="w-full">
                <LogOut className="size-4" /> Sign out & switch account
              </Button>
            </>
          )}

          {status === "used" && (
            <>
              <XCircle className="size-10 mx-auto text-warning" />
              <h1 className="font-display text-xl font-bold text-brand-dark">Invitation already used</h1>
              <p className="text-sm text-muted-foreground">
                This invite has already been accepted, so it can't be used again. If you've already joined, your team is on your dashboard.
              </p>
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>Go to dashboard</Button>
            </>
          )}

          {status === "other-business" && (
            <>
              <XCircle className="size-10 mx-auto text-warning" />
              <h1 className="font-display text-xl font-bold text-brand-dark">Account already in another business</h1>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{user?.email}</span> already belongs to a business, and an account can only be part of one.
                To join {invite?.business ?? "this team"}, sign out and create an account with a different email.
              </p>
              <Button onClick={handleLogout} className="w-full">
                <LogOut className="size-4" /> Sign out & use a different email
              </Button>
            </>
          )}

          {status === "expired" && (
            <>
              <Clock className="size-10 mx-auto text-warning" />
              <h1 className="font-display text-xl font-bold text-brand-dark">Invitation expired</h1>
              <p className="text-sm text-muted-foreground">
                This invitation is no longer valid. Ask the business owner to send you a new one.
              </p>
              <Button variant="outline" className="w-full" onClick={() => navigate("/", { replace: true })}>Go to dashboard</Button>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="size-10 mx-auto text-destructive" />
              <p className="font-medium">Couldn't accept invitation</p>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Button variant="outline" onClick={() => navigate("/")}>Go to dashboard</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
