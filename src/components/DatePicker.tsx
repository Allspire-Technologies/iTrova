import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import type { Matcher } from "react-day-picker";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// The app-wide display format for a picked date: "DD MMM YYYY" (e.g. 05 Jun 2026) — matches
// formatDate()/useDateFormat so a date reads the same in a field as it does in a table.
const DISPLAY = "dd MMM yyyy";
const ISO = "yyyy-MM-dd";

function parseIso(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = parse(v, ISO, new Date());
  return isValid(d) ? d : undefined;
}

export interface DatePickerProps {
  /** ISO date string "yyyy-MM-dd" (or "" for empty). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Forwarded to the wrapper for width (e.g. "w-40"). Defaults to full width. */
  className?: string;
  id?: string;
  disabled?: boolean;
  /** Show an inline clear (×) once a date is picked — for optional/filter dates. */
  clearable?: boolean;
  /** ISO bounds; days outside are disabled in the calendar. */
  min?: string;
  max?: string;
  "aria-label"?: string;
}

export default function DatePicker({
  value, onChange, placeholder = "Pick a date", className, id, disabled, clearable, min, max, ...rest
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const minDate = parseIso(min);
  const maxDate = parseIso(max);
  const ariaLabel = rest["aria-label"];

  const disabledDays = [
    minDate ? { before: minDate } : null,
    maxDate ? { after: maxDate } : null,
  ].filter(Boolean) as Matcher[];

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel ?? (selected ? undefined : placeholder)}
            className={cn(
              "w-full justify-start gap-2 font-normal",
              clearable && selected && "pr-9",
              !selected && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{selected ? format(selected, DISPLAY) : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={disabledDays.length ? disabledDays : undefined}
            onSelect={(d) => { onChange(d ? format(d, ISO) : ""); setOpen(false); }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && selected && !disabled && (
        <button
          type="button"
          aria-label="Clear date"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
