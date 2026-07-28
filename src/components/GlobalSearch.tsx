import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command";
import { useAuth } from "@/contexts/AuthContext";
import { PINNED_ITEMS, NAV_SECTIONS, SETTINGS_ITEM, isNavItemVisible, type NavItem, type NavGrants } from "@/lib/nav";
import { searchRecords, KIND_LABEL, type SearchHit, type SearchKind } from "@/lib/search";
import { openShortcuts } from "@/lib/shortcuts";

// Global "search anything" palette — opens from the header button or ⌘K / Ctrl+K. Searches nav pages
// (client-side) plus products, suppliers, invoices and export invoices (server-side, RLS-scoped).
export default function GlobalSearch() {
  const navigate = useNavigate();
  const { hasModule, can } = useAuth();
  const grants = useMemo<NavGrants>(() => ({ hasModule, can }), [hasModule, can]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Global ⌘K / Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pages the user can actually open (excludes coming-soon and gated modules).
  const pages = useMemo<NavItem[]>(() => {
    const all = [...PINNED_ITEMS, ...NAV_SECTIONS.flatMap((s) => s.items), SETTINGS_ITEM];
    return all.filter((i) => !i.soon && isNavItemVisible(i, grants));
  }, [grants]);

  const pageMatches = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return pages;
    return pages.filter((p) => p.label.toLowerCase().includes(t));
  }, [pages, query]);

  const helpVisible = useMemo(() => {
    const t = query.trim().toLowerCase();
    return !t || "keyboard shortcuts".includes(t);
  }, [query]);

  // Debounced record search.
  useEffect(() => {
    const t = query.trim();
    if (t.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      const results = await searchRecords(t, grants);
      if (id === reqId.current) { setHits(results); setLoading(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, grants]);

  const go = (to: string) => { setOpen(false); setQuery(""); navigate(to); };

  const byKind = (kind: SearchKind) => hits.filter((h) => h.kind === kind);
  const kinds: SearchKind[] = ["product", "supplier", "invoice", "export_invoice"];

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Search"
        title="Search (Ctrl/⌘ K)"
      >
        <Search className="size-5" />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput placeholder="Search pages, products, suppliers, invoices…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{loading ? "Searching…" : "No results found."}</CommandEmpty>

          {pageMatches.length > 0 && (
            <CommandGroup heading="Pages">
              {pageMatches.map((p) => (
                <CommandItem key={p.to} value={`page-${p.to}`} onSelect={() => go(p.to)}>
                  <p.icon className="mr-2 size-4 text-muted-foreground" />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {kinds.map((kind) => {
            const group = byKind(kind);
            if (group.length === 0) return null;
            return (
              <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
                {group.map((h) => (
                  <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h.to)}>
                    <span className="truncate">{h.title}</span>
                    {h.subtitle && <span className="ml-2 truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}

          {helpVisible && (
            <CommandGroup heading="Help">
              <CommandItem value="help-shortcuts" onSelect={() => { setOpen(false); setQuery(""); openShortcuts(); }}>
                <Keyboard className="mr-2 size-4 text-muted-foreground" />
                Keyboard shortcuts
              </CommandItem>
            </CommandGroup>
          )}

          <CommandShortcut className="sr-only">Ctrl/⌘ K</CommandShortcut>
        </CommandList>
      </CommandDialog>
    </>
  );
}
