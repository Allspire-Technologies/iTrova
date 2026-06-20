import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Store } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash and creates a temp session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also handle case where session already exists from the recovery link
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated. Please sign in.");
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-gradient-hero">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-lg p-8 space-y-6">
        <div className="flex items-center gap-2 text-2xl font-display font-bold text-brand-dark">
          <div className="size-10 rounded-xl bg-gradient-brand grid place-items-center text-brand-foreground">
            <Store className="size-5" />
          </div>
          iTrova
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-dark">Set a new password</h1>
          <p className="text-muted-foreground text-sm">
            {ready ? "Choose a strong password you'll remember." : "Verifying your reset link…"}
          </p>
        </div>
        {ready && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp">Confirm password</Label>
              <Input id="cp" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
