import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function usePagination<T>(items: T[], initialSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Clamp page if items shrink
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount, page]);

  const paged = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  return { page, setPage, pageSize, setPageSize, pageCount, total, paged };
}

type Props = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  className?: string;
};

export default function Paginator({
  page, pageCount, pageSize, total, onPageChange, onPageSizeChange, className,
}: Props) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className={`flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-t border-border text-sm ${className || ""}`}>
      <div className="text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}-{to}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground hidden sm:inline">Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map(s => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="First page">
            <ChevronsLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-2 text-muted-foreground tabular-nums">
            Page <span className="font-medium text-foreground">{page}</span> / {pageCount}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPageChange(pageCount)} disabled={page >= pageCount} aria-label="Last page">
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
