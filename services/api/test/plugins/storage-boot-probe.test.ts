import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import type * as ClientS3 from "@aws-sdk/client-s3";

/**
 * The storage plugin's boot-time bucket probe, observed at the S3 client: a recording stub
 * replaces `S3Client`, so any request the boot path would send shows up here instead of
 * leaving the machine (with the env defaults it went to AWS S3 itself).
 */
const s3 = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  sent: [] as string[],
}));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const real = await importOriginal<typeof ClientS3>();
  class S3Client {
    constructor(config: Record<string, unknown>) {
      s3.constructed.push(config);
    }
    async send(command: object): Promise<object> {
      s3.sent.push(command.constructor.name);
      return {};
    }
    destroy(): void {}
  }
  return { ...real, S3Client };
});

const { buildApp } = await import("../../src/app.js");
const { closeDb } = await import("../../src/db/client.js");
const { invalidateStorage } = await import("../../src/storage/index.js");

const saved = { NODE_ENV: process.env.NODE_ENV, STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT };

/** Boot an app with the real storage plugin and let its fire-and-forget probe settle. */
async function bootAndSettle(env: { NODE_ENV: string; STORAGE_ENDPOINT?: string }) {
  process.env.NODE_ENV = env.NODE_ENV;
  if (env.STORAGE_ENDPOINT === undefined) delete process.env.STORAGE_ENDPOINT;
  else process.env.STORAGE_ENDPOINT = env.STORAGE_ENDPOINT;
  invalidateStorage();
  s3.constructed.length = 0;
  s3.sent.length = 0;
  const app = await buildApp();
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    await app.close();
  }
}

describe("storage plugin — the boot-time bucket probe", () => {
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    invalidateStorage();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("sends nothing under test", async () => {
    await bootAndSettle({ NODE_ENV: "test" });
    expect(s3.sent).toEqual([]);
    expect(s3.constructed).toEqual([]);
  });

  it("sends nothing in development without a configured endpoint (it would reach AWS S3)", async () => {
    await bootAndSettle({ NODE_ENV: "development" });
    expect(s3.sent).toEqual([]);
  });

  it("probes the bucket in development against a configured endpoint (a local MinIO)", async () => {
    await bootAndSettle({ NODE_ENV: "development", STORAGE_ENDPOINT: "http://127.0.0.1:9" });
    expect(s3.constructed).toEqual([expect.objectContaining({ endpoint: "http://127.0.0.1:9" })]);
    expect(s3.sent).toEqual(["HeadBucketCommand"]);
  });
});
