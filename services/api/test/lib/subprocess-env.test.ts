import { describe, it, expect } from "vitest";
import { buildSubprocessEnv } from "../../src/lib/subprocess-env.js";

describe("buildSubprocessEnv (A10)", () => {
  const base = {
    PATH: "/usr/bin",
    HOME: "/home/x",
    LANG: "en_US.UTF-8",
    LC_ALL: "C",
    TMPDIR: "/tmp",
    HTTPS_PROXY: "http://proxy:3128",
    PYTHONUNBUFFERED: "1",
    DB_ENCRYPTION_KEY: "enc-key", // pragma: allowlist secret
    DATABASE_URL: "postgres://u@h/db",
    AUTH_LOCAL_SECRET: "local-auth", // pragma: allowlist secret
    STORAGE_SECRET_KEY: "storage", // pragma: allowlist secret
  };

  it("passes only allow-listed variables plus extraEnv", () => {
    const env = buildSubprocessEnv({ TR_PIN: "1234" }, base);
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/x",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      TMPDIR: "/tmp",
      HTTPS_PROXY: "http://proxy:3128",
      PYTHONUNBUFFERED: "1",
      TR_PIN: "1234",
    });
    expect(Object.keys(env)).not.toEqual(
      expect.arrayContaining(["DB_ENCRYPTION_KEY", "DATABASE_URL", "AUTH_LOCAL_SECRET"]),
    );
    expect(env).not.toHaveProperty("STORAGE_SECRET_KEY");
  });

  it("lets extraEnv override and never reads the real process.env secrets", () => {
    process.env.DB_ENCRYPTION_KEY = "leak-me"; // pragma: allowlist secret
    try {
      expect(buildSubprocessEnv()).not.toHaveProperty("DB_ENCRYPTION_KEY");
    } finally {
      delete process.env.DB_ENCRYPTION_KEY;
    }
  });
});
