import { useSyncExternalStore } from "react";

// Light/Dark theme, defaulting to the OS preference until the user picks one. Once they toggle,
// their explicit choice is stored and followed on every device visit. The initial `.dark` class is
// applied pre-paint by the inline script in index.html (keep the two in sync).

export type Theme = "light" | "dark";
const KEY = "itrova-theme";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function storedChoice(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  try {
    return media().matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** The theme actually in effect: the user's explicit choice, or the OS preference until they choose. */
export function currentTheme(): Theme {
  return storedChoice() ?? systemTheme();
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// While the user is still on the system default, follow OS light/dark changes live.
if (typeof window !== "undefined") {
  try {
    media().addEventListener("change", () => {
      if (!storedChoice()) {
        apply(systemTheme());
        emit();
      }
    });
  } catch {
    /* older browsers: no live OS-change sync, choice still works */
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: falls back to in-memory for this session */
  }
  apply(theme);
  emit();
}

export function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Subscribe a component to the effective theme. Returns the theme and a toggle. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTheme,
    (): Theme => "light",
  );
  return { theme, toggle: toggleTheme };
}
