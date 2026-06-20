import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Eye, EyeOff, Store, Users } from "lucide-react";

type Preview = { business_name: string; role: string; email: string };

export default function InviteAuth() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate(`/accept-invite?token=${token}`, { replace: true });
    }
  }, [loading, user, token, navigate]);

  useEffect(() => {
    if (!token) { setPreviewLoading(false); return; }
    supabase.rpc("get_invite_preview", { _token: token }).then(({ data }) => {
      if (data && (data as Preview[]).length > 0) {
        const row = (data as Preview[])[0];
        setPreview(row);
        setSignupEmail(row.email);
        setLoginEmail(row.email);
      }
      setPreviewLoading(false);
    });
  }, [token]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: { data: { full_name: fullName, invite_token: token } },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate(`/accept-invite?token=${token}`, { replace: true });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate(`/accept-invite?token=${token}`, { replace: true });
  };

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center p-4">
        <p className="text-muted-foreground">Invalid invitation link.</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-gradient-hero">
      {/* Brand panel */}
      <section className="hidden lg:flex flex-col justify-between p-12 bg-gradient-brand text-brand-foreground relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 text-2xl font-display font-bold">
            <div className="size-10 rounded-xl bg-brand-foreground/15 backdrop-blur grid place-items-center">
              <Store className="size-5" />
            </div>
            iTrova
          </div>
        </div>
        <div className="relative space-y-6">
          <h1 className="font-display text-5xl font-bold leading-tight">
            You've been<br />invited.
          </h1>
          {previewLoading ? (
            <div className="h-6 w-56 bg-brand-foreground/20 rounded animate-pulse" />
          ) : preview ? (
            <p className="text-brand-foreground/80 text-lg max-w-md">
              Join <span className="font-semibold">{preview.business_name}</span> as a{" "}
              <span className="font-semibold capitalize">{preview.role}</span> on iTrova.
            </p>
          ) : (
            <p className="text-brand-foreground/80 text-lg max-w-md">
              Create your account to join the team on iTrova.
            </p>
          )}
        </div>
        <div className="relative text-xs text-brand-foreground/60">
          © {new Date().getFullYear()} iTrova · Built for Africa
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-2 text-2xl font-display font-bold text-brand-dark">
            <div className="size-10 rounded-xl bg-gradient-brand grid place-items-center text-brand-foreground">
              <Store className="size-5" />
            </div>
            iTrova
          </div>

          {preview && (
            <div className="lg:hidden mb-6 flex items-center gap-3 p-4 rounded-xl bg-brand/10 border border-brand/20">
              <Users className="size-5 text-brand shrink-0" />
              <p className="text-sm text-brand-dark">
                Join <span className="font-semibold">{preview.business_name}</span> as a{" "}
                <span className="font-semibold capitalize">{preview.role}</span>
              </p>
            </div>
          )}

          <Tabs defaultValue="signup" className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-8 bg-secondary">
              <TabsTrigger value="signup">Create account</TabsTrigger>
              <TabsTrigger value="login">Sign in</TabsTrigger>
            </TabsList>

            <TabsContent value="signup" className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="font-display text-3xl font-bold text-brand-dark">Join the team</h2>
                <p className="text-muted-foreground">Create your account to get started.</p>
              </div>
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fn">Your name</Label>
                  <Input
                    id="fn"
                    required
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="se">Email</Label>
                  <Input
                    id="se"
                    type="email"
                    required
                    value={signupEmail}
                    onChange={e => setSignupEmail(e.target.value)}
                    placeholder="Enter your email address"
                    readOnly={!!preview}
                    className={preview ? "bg-muted cursor-not-allowed" : ""}
                  />
                  {preview && (
                    <p className="text-xs text-muted-foreground">
                      This email must match the invitation — it cannot be changed.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sp">Password</Label>
                  <div className="relative">
                    <Input
                      id="sp"
                      type={showSignupPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={signupPassword}
                      onChange={e => setSignupPassword(e.target.value)}
                      placeholder="Create a password (min. 8 characters)"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={showSignupPassword ? "Hide password" : "Show password"}
                    >
                      {showSignupPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cp">Confirm password</Label>
                  <div className="relative">
                    <Input
                      id="cp"
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
                  {busy ? "Creating account..." : "Create account & join"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="login" className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="font-display text-3xl font-bold text-brand-dark">Already have an account?</h2>
                <p className="text-muted-foreground">Sign in to accept the invitation.</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="le">Email</Label>
                  <Input
                    id="le"
                    type="email"
                    required
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="you@example.com"
                    readOnly={!!preview}
                    className={preview ? "bg-muted cursor-not-allowed" : ""}
                  />
                  {preview && (
                    <p className="text-xs text-muted-foreground">
                      Sign in with the email the invitation was sent to.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lp">Password</Label>
                  <div className="relative">
                    <Input
                      id="lp"
                      type={showLoginPassword ? "text" : "password"}
                      required
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                    >
                      {showLoginPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
                  {busy ? "Signing in..." : "Sign in & join"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </main>
  );
}
