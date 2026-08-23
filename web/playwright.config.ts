import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { resetE2EDataDir } from "./e2e/reset-data-dir";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The suite runs against a REAL backend on a throwaway data directory, not against
 * mocked routes. The previous mock-based specs were a second, drifting copy of the
 * API contract and rotted silently — `**​/api/accounts` stopped matching once the
 * app started calling `?include_inactive=true`, and the tests kept passing against
 * whatever happened to be listening on :8000.
 *
 * FINANCE_DATA_DIR points the backend at e2e/.tmp-data, so the suite gets a freshly
 * seeded database and CANNOT reach backend/data/. FINANCE_OFFLINE keeps it off the
 * network (no Yahoo, no FX).
 */
const E2E_BACKEND_PORT = 8801;
const E2E_WEB_PORT = 3100;
// Reset here, at config-module scope: Playwright starts webServer BEFORE
// globalSetup, so wiping in globalSetup destroys the database the backend has
// just created and the server dies part-way through the run.
const DATA_DIR = resetE2EDataDir();
const BACKEND_DIR = path.resolve(__dirname, "../backend");

// `python` on CI, the conda env locally. Override with E2E_PYTHON if neither fits.
const PYTHON = process.env.E2E_PYTHON ?? "python3";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${PYTHON} -m uvicorn main:app --host 127.0.0.1 --port ${E2E_BACKEND_PORT}`,
      cwd: BACKEND_DIR,
      url: `http://127.0.0.1:${E2E_BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { FINANCE_DATA_DIR: DATA_DIR, FINANCE_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npx next start -p ${E2E_WEB_PORT}`,
      url: `http://127.0.0.1:${E2E_WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { BACKEND_URL: `http://127.0.0.1:${E2E_BACKEND_PORT}` },
    },
  ],
});
