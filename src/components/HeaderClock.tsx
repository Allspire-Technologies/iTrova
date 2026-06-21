import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useDateFormat } from "@/hooks/useDateFormat";

// Separate component so only the clock re-renders each tick, not the whole AppShell.
export default function HeaderClock() {
  const { fmtDateTime } = useDateFormat();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums" title="Current time">
      <Clock className="size-4 shrink-0" />
      {fmtDateTime(now, { hour: "numeric", minute: "2-digit" })}
    </div>
  );
}
