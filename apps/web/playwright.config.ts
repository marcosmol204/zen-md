import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 15_000,
  use: { baseURL: "http://localhost:1430", browserName: "chromium" },
  webServer: { command: "npx vite --mode e2e --port 1430", url: "http://localhost:1430", reuseExistingServer: false },
});
