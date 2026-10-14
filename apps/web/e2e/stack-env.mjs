// Shared by playwright.config.ts and start-api.mjs: the env of a `make dev`-equivalent
// stack (embedded PGlite, local-folder storage, DEV_AUTH_TOKEN bypass) on ports that do
// not collide with a normal dev server (3000/3005) or another worktree's.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

export const apiPort = Number(process.env.E2E_API_PORT ?? 3101);
export const webPort = Number(process.env.E2E_WEB_PORT ?? 3105);
export const webUrl = `http://localhost:${webPort}`;

// Throwaway state under the repo (gitignored `.pglite*`/`.storage*`), wiped by `rm -rf`.
const stateDir = path.join(repoRoot, ".pglite-e2e");

export const stackEnv = {
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  PORT: String(apiPort),
  DATABASE_URL: `pglite://${stateDir}`,
  STORAGE_PROVIDER: "folder",
  STORAGE_FOLDER_PATH: path.join(repoRoot, ".storage-e2e"),
  // Deterministic dev PAT, minted by seed-demo for a pglite:// database.
  DEV_AUTH_TOKEN: "pt_dev-pat-for-local-development-only", // pragma: allowlist secret
  API_URL: `http://localhost:${apiPort}`,
  AUTH_URL: webUrl,
  AUTH_SECRET: "e2e-only-not-a-secret-e2e-only-not-a-secret", // pragma: allowlist secret
  RATE_LIMIT_MAX: "100000",
  CHAT_PROVIDER: "",
};
