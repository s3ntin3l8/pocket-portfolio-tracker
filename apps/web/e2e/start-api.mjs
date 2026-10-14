// Boots the API for the e2e stack: wipe + reseed the throwaway PGlite database with the
// demo dataset (same as `make seed-demo`), then run the server. Playwright's `webServer`
// owns the process lifetime. The wipe also guarantees specs start from known data.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { repoRoot, stackEnv } from "./stack-env.mjs";

const env = { ...process.env, ...stackEnv };
const apiDir = path.join(repoRoot, "services/api");
const tsx = path.join(repoRoot, "node_modules/.bin/tsx");

rmSync(path.join(repoRoot, ".pglite-e2e"), { recursive: true, force: true });
rmSync(stackEnv.STORAGE_FOLDER_PATH, { recursive: true, force: true });

const seed = spawnSync(tsx, ["src/db/seed-demo.ts"], { cwd: apiDir, env, stdio: "inherit" });
if (seed.status !== 0) process.exit(seed.status ?? 1);

const server = spawn(tsx, ["src/server.ts"], { cwd: apiDir, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
