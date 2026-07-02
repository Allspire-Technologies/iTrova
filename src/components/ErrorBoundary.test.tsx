import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("kaboom");
}

function ChunkBoom(): JSX.Element {
  throw new Error("Failed to fetch dynamically imported module: /assets/Invoices-abc.js");
}

describe("ErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders children when they don't throw", () => {
    render(<ErrorBoundary><span>all good</span></ErrorBoundary>);
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("shows a recoverable fallback (not a blank screen) when a child throws", () => {
    // React logs caught errors to console.error — silence it so the test output stays clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("shows a connection-oriented message for a failed chunk load", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><ChunkBoom /></ErrorBoundary>);
    expect(screen.getByText("Couldn't load this page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
