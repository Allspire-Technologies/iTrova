import { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The app's one tooltip: use this instead of a native `title` so hover hints look the same
 *  everywhere (and stay readable in dark mode).
 *
 *  `wrap` renders a span around the trigger instead of cloning props onto it. Needed when:
 *   - the trigger is DISABLED (disabled elements emit no pointer events, so the hint — usually the
 *     reason it's disabled — would never show), or
 *   - the child takes a FUNCTION className (React Router's NavLink): Radix's asChild merges
 *     className by string-joining, which stringifies the function and destroys the element's styles.
 *  Pass `wrapperClass` when the span must not be inline (e.g. "block" for a full-width nav row).
 *
 *  Pass no `label` to render the child untouched, so callers can hint conditionally. */
export default function Hint({
  label, children, side = "top", wrap = false, wrapperClass,
}: {
  label?: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  wrap?: boolean;
  wrapperClass?: string;
}) {
  if (!label) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {wrap ? <span className={wrapperClass ?? "inline-flex"}>{children}</span> : children}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}
