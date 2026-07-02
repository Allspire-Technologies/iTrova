import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("kaboom");
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
});
