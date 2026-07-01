import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, Store, Users, Loader2, XCircle, Clock, MailCheck } from "lucide-react";

type Preview = { business_name: string; role: string; email: string };
type InviteState = { status: string; business_name: string | null; email: string | null; role: string | null };

export default function InviteAuth() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [tab, setTab] = useState<"signup" | "login">("signup");
  const [existingHint, setExistingHint] = useState(false);

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
    supabase.rpc("get_invite_state", { _token: token }).then(({ data }) => {
      const row = (data as InviteState[] | null)?.[0];
      setInviteStatus(row?.status ?? "not_found");
      if (row?.status === "valid" && row.business_name && row.email && row.role) {
        setPreview({ business_name: row.business_name, role: row.role, email: row.email });
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
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/accept-invite?token=${encodeURIComponent(token)}`,
        data: { full_name: fullName, invite_token: token },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    // Enumeration protection: signing up an email that already exists returns a user with an
    // empty identities array (and no session, no email sent). Nudge them to sign in instead of
    // showing a "check your email" screen for a mail that will never arrive.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setLoginEmail(signupEmail);
      setExistingHint(true);
      setTab("login");
      toast.info("This email already has an account — sign in to join.");
      return;
    }
    // With email confirmation on, a genuinely new signup returns no session — confirm first.
    if (data.session) {
      toast.success("Account created — joining the team…");
      navigate(`/accept-invite?token=${token}`, { replace: true });
    } else {
      setSignupDone(true);
      toast.success("Account created! Check your email to confirm and finish joining.");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in — joining the team…");
    navigate(`/accept-invite?token=${token}`, { replace: true });
  };

  if (signupDone) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-soft p-4">
        <Card className="max-w-md w-full shadow-card border-border/60">
          <CardContent className="p-8 text-center space-y-4">
            <MailCheck className="size-12 mx-auto text-brand" />
            <h1 className="font-display text-2xl font-bold text-brand-dark">Almost there!</h1>
            <p className="text-sm text-muted-foreground">
              We've sent a confirmation link to <span className="font-medium text-foreground">{signupEmail}</span>.
              Open it to finish joining{preview ? <> <span className="font-medium text-foreground">{preview.business_name}</span></> : " the team"} — it brings you straight back here to accept.
            </p>
            <p className="text-xs text-muted-foreground">Didn't get it? Check your spam folder.</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!token) {
    return <InviteNotice tone="invalid" title="Invalid invitation link"
      body="This invitation link isn't valid. Check the link in your email, or create an account to get started." />;
  }
  if (previewLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-soft p-4">
        <Loader2 className="size-8 animate-spin text-brand" />
      </div>
    );
  }
  if (inviteStatus === "used") {
    return <InviteNotice tone="used" title="Invitation already used" showReset
      body="This invite has already been used, so it can't open the join screen again. If you already created your account, sign in below — or use “Forgot password?” to reset it if you don't remember it. New here? Create an account instead." />;
  }
  if (inviteStatus === "expired") {
    return <InviteNotice tone="expired" title="Invitation expired"
      body="This invitation is no longer valid. Ask the business owner to send you a new invite." />;
  }
  if (inviteStatus !== "valid") {
    return <InviteNotice tone="invalid" title="Invalid invitation link"
      body="This invitation link isn't valid. Check the link in your email, or create an account to get started." />;
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

          {/* Mobile: sit the form in a card like /auth does; desktop keeps the two-panel look. */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "signup" | "login")} className="w-full">
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
              {existingHint && (
                <div className="rounded-lg bg-brand/10 border border-brand/20 p-3 text-sm text-brand-dark">
                  <span className="font-medium">{loginEmail}</span> already has an account. Sign in to join
                  {preview ? <> <span className="font-medium">{preview.business_name}</span></> : " the team"} — or use “Forgot password?” on the main sign-in page if you don't remember it.
                </div>
              )}
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
        </div>
      </section>
    </main>
  );
}

// Shown when an invite link can't open the join screen (already used / expired / invalid). Points the
// person to /auth, where they can sign in, create an account, or use "Forgot password?" to reset.
function InviteNotice({ tone, title, body, showReset }: { tone: "used" | "expired" | "invalid"; title: string; body: string; showReset?: boolean }) {
  const navigate = useNavigate();
  const Icon = tone === "expired" ? Clock : XCircle;
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-soft p-4">
      <Card className="max-w-md w-full shadow-card border-border/60">
        <CardContent className="p-8 text-center space-y-4">
          <Icon className="size-10 mx-auto text-warning" />
          <h1 className="font-display text-xl font-bold text-brand-dark">{title}</h1>
          <p className="text-sm text-muted-foreground">{body}</p>
          <div className="space-y-2 pt-2">
            <Button className="w-full" onClick={() => navigate("/auth")}>Go to sign in / sign up</Button>
            {showReset && (
              <Button variant="outline" className="w-full" onClick={() => navigate("/auth")}>
                Reset my password
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
