import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, LogOut } from "lucide-react";
import { toast } from "sonner";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error" | "wrong-account">("idle");
  const [message, setMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!token) { setStatus("error"); setMessage("No invitation token provided."); return; }
    if (!user) {
      sessionStorage.setItem("pending_invite_token", token);
      navigate(`/invite-auth?token=${encodeURIComponent(token)}`, { replace: true });
      return;
    }
    (async () => {
      setStatus("working");

      // Check the invite email matches the logged-in user before calling the RPC
      const { data: preview } = await supabase.rpc("get_invite_preview", { _token: token });
      const row = (preview as { email: string }[] | null)?.[0];
      if (row && user.email && row.email.toLowerCase() !== user.email.toLowerCase()) {
        setInviteEmail(row.email);
        setStatus("wrong-account");
        return;
      }

      const { error } = await supabase.rpc("accept_invitation", { _token: token });
      if (error) {
        if (error.message.toLowerCase().includes("email") && error.message.toLowerCase().includes("match")) {
          setInviteEmail(row?.email ?? "");
          setStatus("wrong-account");
        } else {
          setStatus("error");
          setMessage(error.message);
        }
        return;
      }
      sessionStorage.removeItem("pending_invite_token");
      await refresh();
      setStatus("done");
      toast.success("You've joined the team!");
      setTimeout(() => navigate("/", { replace: true }), 1200);
    })();
  }, [loading, user, token, navigate, refresh]);

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
              <CheckCircle2 className="size-10 mx-auto text-brand" />
              <p className="font-medium">You're in! Redirecting…</p>
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
