// Shared bits for the keyboard-shortcuts reference, kept out of the component file so fast-refresh
// stays happy (components-only exports there).

export const SHORTCUTS_EVENT = "itrova:open-shortcuts";

/** Open the Keyboard shortcuts dialog from anywhere (e.g. the search palette). */
export function openShortcuts() {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
/** The primary modifier key label for this platform: ⌘ on Mac, Ctrl elsewhere. */
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
