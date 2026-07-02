import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RotateCw, Store } from "lucide-react";

// Draws the app's own title bar into the Window Controls Overlay region of an installed desktop
// PWA — the green strip at the very top, beside the OS minimize/close buttons — so the app has the
// Back and Reload controls a standalone window otherwise lacks. Only renders when the overlay is
// actually visible (desktop installed PWA); in a browser tab or a mobile standalone launch it
// returns null and the layout is unaffected (--titlebar-h stays 0).

type Wco = { visible: boolean; addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void };

function useWindowControlsOverlay(): boolean {
  const wco = (navigator as unknown as { windowControlsOverlay?: Wco }).windowControlsOverlay;
  const [visible, setVisible] = useState<boolean>(!!wco?.visible);
  useEffect(() => {
    if (!wco) return;
    const update = () => setVisible(wco.visible);
    update();
    wco.addEventListener("geometrychange", update);
    return () => wco.removeEventListener("geometrychange", update);
  }, [wco]);
  return visible;
}

export default function PwaTitlebar() {
  const navigate = useNavigate();
  const visible = useWindowControlsOverlay();
  if (!visible) return null;

  // Full-width green strip (seamless behind the OS buttons), with its interactive content padded
  // past any left-side window controls (macOS) via titlebar-area-x. Buttons stay left-aligned so
  // they never land under the right-side controls (Windows). The strip is a window drag region;
  // the buttons opt out so they stay clickable.
  const bar: CSSProperties = {
    position: "fixed",
    left: 0,
    top: "env(titlebar-area-y, 0px)",
    width: "100%",
    height: "env(titlebar-area-height, 33px)",
    paddingLeft: "env(titlebar-area-x, 0px)",
    WebkitAppRegion: "drag",
  } as CSSProperties;
  const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

  return (
    <div style={bar} className="z-50 flex items-center gap-1 bg-brand px-1.5 text-brand-foreground select-none">
      <button
        type="button"
        style={noDrag}
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="grid size-8 place-items-center rounded-md hover:bg-brand-foreground/15 transition-colors"
      >
        <ArrowLeft className="size-4" />
      </button>
      <button
        type="button"
        style={noDrag}
        onClick={() => window.location.reload()}
        aria-label="Reload"
        className="grid size-8 place-items-center rounded-md hover:bg-brand-foreground/15 transition-colors"
      >
        <RotateCw className="size-4" />
      </button>
      <div className="ml-1 flex items-center gap-1.5 text-sm font-display font-semibold">
        <Store className="size-3.5" /> iTrova
      </div>
    </div>
  );
}
