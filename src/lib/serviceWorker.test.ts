import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The service worker can't be exercised in jsdom, but its contract with the build-time stamper
// (scripts/stamp-sw.mjs) can: if either placeholder disappears, deploys would ship a SW with a
// stale cache name or an empty precache list — silently breaking the offline cold-launch fix.
const sw = readFileSync("public/sw.js", "utf8");
const stamper = readFileSync("scripts/stamp-sw.mjs", "utf8");

describe("service worker / stamper contract", () => {
  it("keeps the build-id placeholder the stamper replaces per deploy", () => {
    expect(sw).toContain("__BUILD_ID__");
    expect(stamper).toContain("__BUILD_ID__");
  });

  it("keeps the precache placeholder so the build's bundles get cached for offline launch", () => {
    expect(sw).toContain("/* __PRECACHE__ */");
    expect(stamper).toContain("/* __PRECACHE__ */");
    // The empty placeholder must be valid JS on its own (dev/preview run the unstamped file).
    expect(sw).toMatch(/const ASSETS = \[\/\* __PRECACHE__ \*\/\];/);
    expect(sw).toContain("...ASSETS"); // the shell actually includes the precached bundles
  });

  it("does not call skipWaiting — a new SW must not purge a running page's assets mid-deploy", () => {
    // (the rationale comment may mention the name; what must not exist is the actual call)
    expect(sw).not.toContain("self.skipWaiting");
  });
});
