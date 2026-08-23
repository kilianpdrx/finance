import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const E2E_DATA_DIR = path.resolve(__dirname, ".tmp-data");

/**
 * Wipe the throwaway data directory so every run starts from a freshly seeded
 * database.
 *
 * Two ordering traps, both of which showed up as the backend dying mid-suite
 * after answering a few requests off a deleted file handle:
 *
 *  1. NOT from globalSetup — Playwright launches `webServer` *before* globalSetup
 *     runs, so the wipe would destroy the database the backend just created.
 *  2. Only in the main process — Playwright re-imports the config in every worker,
 *     so an unguarded side effect at config-module scope runs again once tests
 *     start. `TEST_WORKER_INDEX` is defined only in workers.
 *
 * The path check is deliberate: it refuses to delete anything that isn't the
 * expected e2e/.tmp-data, so this can never take out the real backend/data/.
 */
export function resetE2EDataDir(): string {
  if (process.env.TEST_WORKER_INDEX !== undefined) return E2E_DATA_DIR;

  const expected = path.join("web", "e2e", ".tmp-data");
  if (!E2E_DATA_DIR.endsWith(expected)) {
    throw new Error(`Refusing to wipe an unexpected data directory: ${E2E_DATA_DIR}`);
  }
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  return E2E_DATA_DIR;
}
