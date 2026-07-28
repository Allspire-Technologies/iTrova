import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SHORTCUTS_EVENT, MOD_KEY } from "@/lib/shortcuts";

// A discoverable reference for the app's keyboard shortcuts. Opens on "?" (when not typing) or when
// any component calls openShortcuts() — e.g. the search palette's "Keyboard shortcuts" entry.

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

type Shortcut = { keys: string[]; label: string };
const SHORTCUTS: Shortcut[] = [
  { keys: [MOD_KEY, "K"], label: "Open search" },
  { keys: [MOD_KEY, "B"], label: "Show / hide the sidebar" },
  { keys: ["?"], label: "Show this shortcuts list" },
  { keys: ["Esc"], label: "Close a dialog or the search" },
];

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onEvent = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't hijack "?" while the user is typing.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener(SHORTCUTS_EVENT, onEvent);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(SHORTCUTS_EVENT, onEvent);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work faster with these. Press <Kbd>?</Kbd> any time to see them again.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border/60">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-foreground">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
