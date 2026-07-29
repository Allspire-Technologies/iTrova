import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { unseenEntries, markAllSeen, type WhatsNewEntry } from "@/lib/whatsNew";

// One-time wizard stepping through features the user hasn't seen. Shows once (dismissal persisted),
// only for a real signed-in business.
export default function WhatsNew() {
  const { business } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<WhatsNewEntry[]>([]);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!business) return;
    const unseen = unseenEntries();
    if (unseen.length) { setEntries(unseen); setI(0); setOpen(true); }
  }, [business]);

  const close = () => { markAllSeen(); setOpen(false); };
  // Take the user to the page where the feature lives, then dismiss.
  const goTo = (route: string) => { markAllSeen(); setOpen(false); navigate(route); };

  if (!entries.length) return null;
  const e = entries[i];
  const Icon = e.icon;
  const first = i === 0;
  const last = i === entries.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="text-center text-xs font-semibold uppercase tracking-wider text-brand">What's new</div>
          <div className="mx-auto my-2 grid size-12 place-items-center rounded-2xl bg-brand-light text-brand">
            <Icon className="size-6" />
          </div>
          <DialogTitle className="text-center">{e.title}</DialogTitle>
        </DialogHeader>
        <p className="text-center text-sm text-muted-foreground">{e.body}</p>

        {entries.length > 1 && (
          <div className="flex justify-center gap-1.5 pt-1">
            {entries.map((_, idx) => (
              <span key={idx} className={`size-1.5 rounded-full transition-colors ${idx === i ? "bg-brand" : "bg-border"}`} />
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {first ? (
            <Button variant="ghost" size="sm" onClick={close}>Skip</Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>Back</Button>
          )}
          {last ? (
            e.route
              ? <Button size="sm" onClick={() => goTo(e.route!)}>{e.cta ?? "Take me there"}</Button>
              : <Button size="sm" onClick={close}>Got it</Button>
          ) : (
            <Button size="sm" onClick={() => setI(i + 1)}>Next</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
