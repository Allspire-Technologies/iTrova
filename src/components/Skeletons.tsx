import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Store } from "lucide-react";

// ── Table-based list pages (Inventory, Suppliers, RawMaterials, Invoices, POs) ──
export function TablePageSkeleton({ rows = 7 }: { rows?: number }) {
  const cols = ["w-1/6", "w-1/4", "w-1/5", "w-1/5", "w-1/6"];
  return (
    <div className="space-y-6 w-full animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-10 w-32 shrink-0" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Card className="shadow-card border-border/60">
        <div className="overflow-hidden">
          <div className="flex gap-4 px-4 py-3 border-b border-border bg-secondary/30">
            {cols.map((w, i) => <Skeleton key={i} className={`h-3.5 ${w}`} />)}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3.5 border-b border-border/50 last:border-0">
              {cols.map((w, j) => <Skeleton key={j} className={`h-5 ${w}`} />)}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Dashboard ──
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 w-full animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="shadow-card border-border/60">
            <CardContent className="p-5 space-y-3">
              <div className="flex justify-between items-start">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="size-10 rounded-xl" />
              </div>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-card border-border/60">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-5 w-24" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="shadow-card border-border/60">
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── POS product grid ──
export function POSSkeleton() {
  return (
    <div className="space-y-6 w-full animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr,400px] gap-6">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    </div>
  );
}

// ── Team member rows ──
export function TeamMembersSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
          <Skeleton className="size-9 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-24 hidden sm:block" />
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ── Reports chart area (inline, used alongside existing page structure) ──
export function ReportsChartSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-4 animate-fade-in">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="shadow-card border-border/60">
          <CardContent className="p-5 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-14" />
          </CardContent>
        </Card>
      ))}
      <Card className="lg:col-span-4 shadow-card border-border/60">
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Full-page shell skeleton (shown during auth initialisation) ──
export function AppShellSkeleton() {
  return (
    <div className="min-h-screen flex bg-gradient-soft">
      <aside className="hidden lg:flex flex-col w-64 bg-sidebar shrink-0">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-sidebar-border">
          <div className="size-9 rounded-xl bg-sidebar-primary grid place-items-center text-sidebar-primary-foreground shrink-0">
            <Store className="size-4" />
          </div>
          <Skeleton className="h-5 w-20" style={{ background: "hsl(var(--sidebar-accent))" }} />
        </div>
        <div className="flex-1 p-2 space-y-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-11 w-full rounded-lg"
              style={{ background: "hsl(var(--sidebar-accent))", opacity: 1 - i * 0.07 }}
            />
          ))}
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background/80 flex items-center px-4 lg:px-8 gap-4">
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <DashboardSkeleton />
        </main>
      </div>
    </div>
  );
}
