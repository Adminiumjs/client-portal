/**
 * The browser pass (`npm run e2e`): the Client Portal on a built Adminium,
 * one Playwright project per engine, run one after another on the same ports
 * (4961–4963). Postgres and MySQL need `TEST_POSTGRES_URL` / `TEST_MYSQL_URL`;
 * every run needs `ADMINIUM_REPO` (a built Adminium) and `ADD_ONS_REPO`, and
 * the surfaces built first (`npm run build:surface`). The files are named
 * `*.e2e.ts` so the unit suite (vitest) never collects them.
 */
import { defineConfig } from "@playwright/test";

// One stamp for the whole run, which every worker inherits (a worker restarts after a failed test).
process.env["E2E_RUN_STARTED"] ??= String(Date.now());

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "e2e-results/report.json" }]],
  outputDir: "e2e-results/artifacts",
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure", actionTimeout: 20_000, navigationTimeout: 60_000 },
  projects: [
    { name: "sqlite", metadata: { engine: "sqlite" } },
    { name: "postgres", metadata: { engine: "postgres" } },
    { name: "mysql", metadata: { engine: "mysql" } },
  ],
});
