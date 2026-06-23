import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Serve a production build so there's no first-request dep-optimization stall.
    // Call vite preview directly: the `preview` script is repurposed for `wrangler dev`,
    // which rejects Vite's --strictPort flag.
    command: "npm run build && npx vite preview --port 8080 --strictPort",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Placeholder Supabase env so createClient initialises; all Supabase
    // traffic is intercepted by the tests, so the real values are never used.
    env: {
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
    },
  },
});
