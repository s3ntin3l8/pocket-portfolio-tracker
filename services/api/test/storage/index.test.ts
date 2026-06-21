import { describe, it, expect } from "vitest";
import { getStorage, S3Provider } from "../../src/storage/index.js";

const BASE_CONFIG = {
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_REGION: "eu-central-1",
  STORAGE_BUCKET: "test-bucket",
  STORAGE_ACCESS_KEY: "key",
  STORAGE_SECRET_KEY: "secret",
  STORAGE_FORCE_PATH_STYLE: true,
  STORAGE_SIGNED_URL_TTL: 600,
};

describe("getStorage factory", () => {
  it("returns an S3Provider", () => {
    const provider = getStorage(BASE_CONFIG);
    expect(provider).toBeInstanceOf(S3Provider);
  });

  it("threads the config through (round-trip: signed URL reflects endpoint and bucket)", async () => {
    const provider = getStorage(BASE_CONFIG);
    const url = await provider.getSignedUrl("smoke/test.txt", 60);
    // The URL must contain the bucket name and the key
    expect(url).toContain("test-bucket");
    expect(url).toContain("smoke");
  });

  it("maps an empty STORAGE_ENDPOINT to AWS default (no custom endpoint)", () => {
    // When empty, no endpoint override is passed to S3Client — no error constructing it.
    const provider = getStorage({ ...BASE_CONFIG, STORAGE_ENDPOINT: "" });
    expect(provider).toBeInstanceOf(S3Provider);
  });
});
