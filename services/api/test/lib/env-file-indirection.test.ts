import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

describe("env plugin _FILE indirection", () => {
  let tmpDir: string;
  let secretPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-envfile-"));
    secretPath = path.join(tmpDir, "db_encryption_key");
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DB_ENCRYPTION_KEY;
    delete process.env.DB_ENCRYPTION_KEY_FILE;
    delete process.env.STORAGE_SECRET_KEY;
    delete process.env.STORAGE_SECRET_KEY_FILE;
    await closeDb();
  });

  it("reads a secret from *_FILE when set", async () => {
    fs.writeFileSync(secretPath, "supersecret\n", { mode: 0o600 });
    process.env.DB_ENCRYPTION_KEY_FILE = secretPath;

    const app = await buildApp();
    expect(app.config.DB_ENCRYPTION_KEY).toBe("supersecret");
    await app.close();
  });

  it("trims trailing whitespace/newlines from the file contents", async () => {
    // Docker secrets are typically written verbatim by the orchestrator with a trailing
    // newline — the loaded value should match what's in the file, not include the newline.
    fs.writeFileSync(secretPath, "another-secret\n");
    process.env.DB_ENCRYPTION_KEY_FILE = secretPath;

    const app = await buildApp();
    expect(app.config.DB_ENCRYPTION_KEY).toBe("another-secret");
    await app.close();
  });

  it("prefers *_FILE over the inline variable when both are set", async () => {
    fs.writeFileSync(secretPath, "from-file");
    process.env.DB_ENCRYPTION_KEY = "from-inline";
    process.env.DB_ENCRYPTION_KEY_FILE = secretPath;

    const app = await buildApp();
    expect(app.config.DB_ENCRYPTION_KEY).toBe("from-file");
    await app.close();
  });

  it("throws when *_FILE points at a non-existent path", async () => {
    process.env.DB_ENCRYPTION_KEY_FILE = path.join(tmpDir, "does-not-exist");

    // Misconfigured secrets MUST fail loud at startup, not silently fall back to "".
    await expect(buildApp()).rejects.toThrow();
  });
});
