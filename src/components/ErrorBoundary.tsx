import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { isChunkLoadError } from "@/lib/lazyWithRetry";

type Props = {
  children: ReactNode;
  /** "screen" fills the viewport (top-level); "inline" fits inside the app shell's content area. */
  variant?: "screen" | "inline";
};
type State = { error: Error | null };

// Catches render/lifecycle errors anywhere below it and shows a recoverable fallback instead of a
// blank white screen (Experience Roadmap · Phase 2 · F2). Intentionally dependency-light — it must
// still render even if a context/provider is what threw.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No remote error reporting is wired up yet; log so it's visible in the console / SW logs.
    console.error("Uncaught UI error:", error, info.componentStack);
  }

  private reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    const inline = this.props.variant === "inline";
    const chunk = isChunkLoadError(this.state.error);
    const Icon = chunk ? WifiOff : AlertTriangle;
    return (
      <div className={`${inline ? "min-h-[60vh]" : "min-h-screen bg-gradient-soft"} grid place-items-center p-4`}>
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center shadow-card space-y-4">
          <div className="size-12 rounded-xl bg-danger/10 text-danger grid place-items-center mx-auto">
            <Icon className="size-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-brand-dark">
            {chunk ? "Couldn't load this page" : "Something went wrong"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {chunk
              ? "This page couldn't be downloaded — check your internet connection and try again. Any sales you saved offline are safe on this device."
              : "The app hit an unexpected error. Reloading usually fixes it — any sales you saved offline are safe on this device."}
          </p>
          <button
            onClick={this.reload}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-medium text-brand-foreground shadow-brand transition-opacity hover:opacity-90"
          >
            {chunk ? "Try again" : "Reload"}
          </button>
        </div>
      </div>
    );
  }
}
