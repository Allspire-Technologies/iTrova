import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Register the PWA service worker in real browsers only. Skipped under automation
// (navigator.webdriver) so it can't intercept requests during e2e, and only in prod builds.
// The app works fine without it.
if (import.meta.env.PROD && "serviceWorker" in navigator && !navigator.webdriver) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-fatal: app works without the SW */
    });
  });
}
