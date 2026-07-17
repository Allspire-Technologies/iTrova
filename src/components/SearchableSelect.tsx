import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; disabled?: boolean };

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Forwarded to the trigger button — use for width/height overrides e.g. "w-40 h-8" */
  className?: string;
  /** Accessible name for the combobox trigger; falls back to the placeholder. */
  ariaLabel?: string;
}

export default function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled,
  className,
  ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const selected = options.find(o => o.value === value);

  const trigger = (
    <button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-label={ariaLabel ?? placeholder}
      disabled={disabled}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        "flex h-10 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {selected
        ? <span className="flex-1 text-left line-clamp-1">{selected.label}</span>
        : <span className="flex-1 text-left text-muted-foreground">{placeholder}</span>
      }
      <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
    </button>
  );

  // Search input + options — the same list for both layouts.
  const inner = (
    <>
      <CommandInput placeholder={searchPlaceholder} />
      {/* Fill the sheet on mobile so the results sit between the top-pinned input and the keyboard. */}
      <CommandList className={isMobile ? "max-h-[calc(100dvh-8rem)]" : undefined}>
        <CommandEmpty>{emptyText}</CommandEmpty>
        <CommandGroup>
          {options.map(opt => (
            <CommandItem
              key={opt.value}
              value={opt.label}
              disabled={opt.disabled}
              onSelect={() => {
                if (!opt.disabled) {
                  onValueChange(opt.value);
                  setOpen(false);
                }
              }}
            >
              <Check className={cn("mr-2 size-4 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{opt.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </>
  );

  // Mobile: a full-screen command sheet. The search input pins to the top and the soft keyboard
  // sits at the bottom, so what you type AND the filtered results stay visible at once — a plain
  // popover gets covered by the keyboard when the trigger is low on the page.
  if (isMobile) {
    return (
      <>
        {trigger}
        <CommandDialog open={open} onOpenChange={disabled ? undefined : setOpen}>
          {inner}
        </CommandDialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
      >
        <Command>{inner}</Command>
      </PopoverContent>
    </Popover>
  );
}
