import { getLegalLink } from "@/lib/legalLinks";

// Small consent line shown under the sign-in / create-account buttons. Links to the public,
// canonical legal docs on allspire.tech (the in-app /legal viewer is auth-gated, these aren't).
export default function ConsentNote({ action = "continuing" }: { action?: string }) {
  const terms = getLegalLink("terms");
  const privacy = getLegalLink("privacy");
  return (
    <p className="text-xs text-muted-foreground text-center">
      By {action}, you agree to our{" "}
      <a href={terms?.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
        Terms of Service
      </a>{" "}
      and{" "}
      <a href={privacy?.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
        Privacy Policy
      </a>.
    </p>
  );
}
