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
const { getStorageProvider, invalidateStorage } = await import("../../src/storage/index.js");

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
};

/**
 * Boot an app with the real storage plugin and hand it to `check`. The storage env is set
 * explicitly, never deleted: outside NODE_ENV=test the env plugin loads dotenv, and a key
 * that is absent could come from a local `.env` (dotenv doesn't override a present one).
 */
async function boot(
  env: { NODE_ENV: string; STORAGE_ENDPOINT?: string },
  check: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<void>,
) {
  process.env.NODE_ENV = env.NODE_ENV;
  process.env.STORAGE_PROVIDER = "s3";
  process.env.STORAGE_ENDPOINT = env.STORAGE_ENDPOINT ?? "";
  invalidateStorage();
  s3.constructed.length = 0;
  s3.sent.length = 0;
  const app = await buildApp();
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

/** Let the plugin's fire-and-forget provider resolution finish: resolve the same provider
 *  ourselves, then yield once more so its `.then` has run. A slow host can only delay this
 *  (it never turns a "nothing sent" case red). */
async function settle(app: Awaited<ReturnType<typeof buildApp>>) {
  await getStorageProvider(app);
  await new Promise((resolve) => setTimeout(resolve, 50));
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
    await boot({ NODE_ENV: "test" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(s3.sent).toEqual([]);
    expect(s3.constructed).toEqual([]);
  });

  it("sends nothing in production", async () => {
    await boot({ NODE_ENV: "production", STORAGE_ENDPOINT: "http://127.0.0.1:9" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(s3.sent).toEqual([]);
  });

  it("sends nothing in development without a configured endpoint (it would reach AWS S3)", async () => {
    await boot({ NODE_ENV: "development" }, settle);
    expect(s3.sent).toEqual([]);
  });

  it("probes the bucket in development against a configured endpoint (a local MinIO)", async () => {
    await boot({ NODE_ENV: "development", STORAGE_ENDPOINT: "http://127.0.0.1:9" }, async () => {
      // Waits for the probe itself rather than a fixed time.
      await vi.waitFor(() => expect(s3.sent).toEqual(["HeadBucketCommand"]), {
        timeout: 10_000,
      });
    });
    expect(s3.constructed).toEqual([expect.objectContaining({ endpoint: "http://127.0.0.1:9" })]);
  });
});
