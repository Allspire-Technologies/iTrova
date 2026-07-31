import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import Hint from "@/components/Hint";

// Header Light/Dark switch. Shows the icon for the mode you'd switch TO.
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Hint label={label} side="bottom">
      <Button variant="ghost" size="icon" onClick={toggle} aria-label={label}>
        {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </Button>
    </Hint>
  );
}
