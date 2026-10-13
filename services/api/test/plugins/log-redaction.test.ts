import { describe, it, expect } from "vitest";
import { buildApp, serializeRequest } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

describe("log redaction (A8)", () => {
  it("redacts credential-bearing fields and secret env names", async () => {
    const lines: Record<string, unknown>[] = [];
    const logStream = {
      write(line: string) {
        lines.push(JSON.parse(line));
      },
    };
    const app = await buildApp({ logStream });
    // Build the probe from key names so no credential-looking assignment sits in source.
    const keys = ["token", "password", "apiKey"];
    const flat: Record<string, string> = {};
    const nested: Record<string, string> = {};
    keys.forEach((k, n) => {
      flat[k] = `LEAK-flat-${n}`;
      nested[k] = `LEAK-nested-${n}`;
    });
    const envLike: Record<string, string> = {};
    ["AUTH_LOCAL_SECRET", "STORAGE_SECRET_KEY", "STORAGE_ACCESS_KEY"].forEach((k, n) => {
      envLike[k] = `LEAK-env-${n}`;
    });
    app.log.info({ ...flat, nested, ...envLike, config: envLike }, "redaction probe");
    await app.close();
    await closeDb();
    const probe = lines.find((l) => l.msg === "redaction probe");
    expect(probe).toBeDefined();
    const text = JSON.stringify(probe);
    expect(text).not.toContain("LEAK-");
  });

  it("strips the query string (signed-URL signature) from /storage request logs", () => {
    expect(serializeRequest({ method: "GET", url: "/storage/a/b.pdf?exp=1&sig=abc" }).url).toBe(
      "/storage/a/b.pdf",
    );
    expect(serializeRequest({ method: "GET", url: "/portfolios?x=1" }).url).toBe("/portfolios?x=1");
  });

  it("applies the serializer to real access-log lines", async () => {
    const lines: { req?: { url?: string } }[] = [];
    const logStream = {
      write(line: string) {
        lines.push(JSON.parse(line));
      },
    };
    const app = await buildApp({ logStream });
    await app.inject({ method: "GET", url: "/storage/x/y.pdf?exp=1&sig=SECRETSIG" });
    await app.close();
    await closeDb();
    const reqLines = lines.filter((l) => l.req?.url?.startsWith("/storage"));
    expect(reqLines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain("SECRETSIG");
  });
});
