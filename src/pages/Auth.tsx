import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SearchableSelect from "@/components/SearchableSelect";
import { INDUSTRY_OPTIONS } from "@/lib/industries";
import { isValidEmail, normalizeEmail } from "@/lib/emailVerification";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { toast } from "sonner";
import { Eye, EyeOff, Sparkles, Store, MailCheck, WifiOff } from "lucide-react";
import { useOnline } from "@/contexts/OnlineContext";
import ConsentNote from "@/components/ConsentNote";

export default function Auth() {
  const { user, loading } = useAuth();
  const { online } = useOnline();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // signup
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupComplete, setSignupComplete] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(signupEmail)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (phone.trim() && !isValidPhone(phone)) {
      toast.error("Enter a valid phone number (10–15 digits)");
      return;
    }
    if (industry === "Other" && !industryOther.trim()) {
      toast.error("Tell us your industry");
      return;
    }
    if (signupPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(signupEmail),
      password: signupPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          business_name: businessName,
          owner_name: ownerName,
          phone: normalizePhone(phone),
          industry,
          industry_other: industry === "Other" ? industryOther.trim() : "",
          city: city.trim(),
          state: state.trim(),
        },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    // When email confirmation is enabled, signUp returns no session — the user
    // must activate via the emailed link before they can sign in.
    if (data.session) {
      toast.success("Welcome to iTrova! Setting up your business...");
      navigate("/");
    } else {
      setSignupComplete(true);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(loginEmail)) {
      toast.error("Enter a valid email address");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(loginEmail), password: loginPassword });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate("/");
  };

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-gradient-hero">
      {/* Brand panel */}
      <section className="hidden lg:flex flex-col justify-between p-12 bg-gradient-brand text-brand-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
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
            Run your business<br/>like a pro.
          </h1>
          <p className="text-brand-foreground/80 text-lg max-w-md">
            Inventory, sales, suppliers and staff — one platform built for business owners across Africa.
          </p>
          <div className="flex items-center gap-2 text-sm text-brand-foreground/70">
            <Sparkles className="size-4" />
            Trusted by traders, processors and distributors
          </div>
        </div>
        <div className="relative text-xs text-brand-foreground/60">
          © {new Date().getFullYear()} iTrova · Built for Africa
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-4 py-8 sm:p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-6 flex items-center gap-2 text-2xl font-display font-bold text-brand-dark">
            <div className="size-10 rounded-xl bg-gradient-brand grid place-items-center text-brand-foreground">
              <Store className="size-5" />
            </div>
            iTrova
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          {!online && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
              <WifiOff className="size-5 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-brand-dark">You're offline</p>
                <p className="text-xs text-muted-foreground">Signing in and creating an account need an internet connection. Reconnect to continue. (If you were already signed in, your saved offline sales are safe on this device.)</p>
              </div>
            </div>
          )}
          {signupComplete ? (
            <div className="animate-fade-in text-center space-y-6">
              <div className="size-16 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto">
                <MailCheck className="size-8" />
              </div>
              <div className="space-y-2">
                <h2 className="font-display text-3xl font-bold text-brand-dark">Check your inbox</h2>
                <p className="text-muted-foreground">
                  Your business <span className="font-medium text-brand-dark">{businessName}</span> has been created. We've sent an activation link to <span className="font-medium text-brand-dark">{signupEmail}</span>.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-4 text-left space-y-3">
                <p className="text-sm font-semibold text-brand-dark">Activate your account to continue</p>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2"><span className="font-semibold text-brand">1.</span> Open the email from iTrova</li>
                  <li className="flex gap-2"><span className="font-semibold text-brand">2.</span> Click the activation link</li>
                  <li className="flex gap-2"><span className="font-semibold text-brand">3.</span> Sign in to finish setting up your business</li>
                </ol>
              </div>
              <p className="text-xs text-muted-foreground">
                Didn't receive it? Check your spam folder — the link can take a minute to arrive.
              </p>
              <Button variant="hero" size="lg" className="w-full" onClick={() => setSignupComplete(false)}>
                Back to sign in
              </Button>
            </div>
          ) : (
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-8 bg-secondary">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="font-display text-3xl font-bold text-brand-dark">Welcome back</h2>
                <p className="text-muted-foreground">Sign in to manage your business.</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="le">Email</Label>
                  <Input id="le" type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@yourbusiness.com" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="lp">Password</Label>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!loginEmail) return toast.error("Enter your email first");
                        setBusy(true);
                        const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
                          redirectTo: `${window.location.origin}/reset-password`,
                        });
                        setBusy(false);
                        if (error) return toast.error(error.message);
                        toast.success("Check your email for a reset link.");
                      }}
                      className="text-xs font-medium text-brand-dark hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input id="lp" type={showLoginPassword ? "text" : "password"} required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Enter your password" className="pr-10" />
                    <button type="button" onClick={() => setShowLoginPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-pressed={showLoginPassword} aria-label={showLoginPassword ? "Hide password" : "Show password"}>
                      {showLoginPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy || !online}>
                  {busy ? "Signing in..." : "Sign in"}
                </Button>
                <ConsentNote action="signing in" />
              </form>

            </TabsContent>

            <TabsContent value="signup" className="space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h2 className="font-display text-3xl font-bold text-brand-dark">Start in minutes</h2>
                <p className="text-muted-foreground">Set up your business and get going.</p>
              </div>
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bn">Business name *</Label>
                  <Input id="bn" required value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Enter your business name" />
                </div>
                <div className="space-y-2">
                  <Label>Industry</Label>
                  <SearchableSelect
                    value={industry}
                    onValueChange={setIndustry}
                    options={INDUSTRY_OPTIONS}
                    placeholder="Select your industry"
                  />
                </div>
                {industry === "Other" && (
                  <div className="space-y-2">
                    <Label htmlFor="io">Which industry? *</Label>
                    <Input id="io" value={industryOther} onChange={e => setIndustryOther(e.target.value)} placeholder="Tell us your industry" />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Ikeja" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input id="state" value={state} onChange={e => setState(e.target.value)} placeholder="e.g. Lagos" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="on">Your name *</Label>
                    <Input id="on" required value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Enter your full name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ph">Phone</Label>
                    <Input id="ph" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d+]/g, ""))} placeholder="e.g. 08031234567" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="se">Email *</Label>
                  <Input id="se" type="email" inputMode="email" autoComplete="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="Enter your email address" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sp">Password *</Label>
                  <div className="relative">
                    <Input id="sp" type={showSignupPassword ? "text" : "password"} required minLength={8} value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="Create a password (min. 8 characters)" className="pr-10" />
                    <button type="button" onClick={() => setShowSignupPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-pressed={showSignupPassword} aria-label={showSignupPassword ? "Hide password" : "Show password"}>
                      {showSignupPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cp">Confirm password *</Label>
                  <div className="relative">
                    <Input id="cp" type={showConfirmPassword ? "text" : "password"} required minLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" className="pr-10" />
                    <button type="button" onClick={() => setShowConfirmPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-pressed={showConfirmPassword} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                      {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy || !online}>
                  {busy ? "Creating..." : "Create my business"}
                </Button>
                <ConsentNote action="creating your business" />
              </form>
            </TabsContent>
          </Tabs>
          )}
          </div>
        </div>
      </section>
    </main>
  );
}
