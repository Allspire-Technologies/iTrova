import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getLegalLink } from "@/lib/legalLinks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function LegalDoc() {
  const { slug } = useParams();
  const doc = getLegalLink(slug);
  if (!doc) return <Navigate to="/settings" replace />;

  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button asChild variant="ghost" size="icon" aria-label="Back to settings">
            <Link to="/settings"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-display font-bold truncate">{doc.label}</h1>
            <p className="text-sm text-muted-foreground">{doc.description}</p>
          </div>
        </div>
        <Button asChild variant="outline">
          <a href={doc.href} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4 mr-1" /> Open original
          </a>
        </Button>
      </div>

      <Card className="overflow-hidden p-0 shadow-card border-border/60">
        <iframe
          src={doc.href}
          title={doc.label}
          className="w-full h-[calc(100vh-14rem)] min-h-[480px] bg-white"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </Card>

      <p className="text-xs text-muted-foreground">
        Trouble viewing the document?{" "}
        <a href={doc.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
          Open it in a new tab
        </a>.
      </p>
    </div>
  );
}
