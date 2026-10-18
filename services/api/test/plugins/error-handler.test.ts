import { describe, it, expect, afterEach, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

describe("global error handler", () => {
  it("masks internal error details on an unhandled 5xx (no driver/message text leaked)", async () => {
    const app = await buildApp();
    app.get("/__test_boom", async () => {
      throw new Error('duplicate key value violates unique constraint "documents_storage_key_idx"');
    });
    const res = await app.inject({ method: "GET", url: "/__test_boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error" });
    await app.close();
    await closeDb();
  });

  it("also masks an explicit statusCode >= 500", async () => {
    const app = await buildApp();
    app.get("/__test_bad_gateway", async () => {
      const err = new Error("upstream provider timed out at 10.0.0.5:443") as Error & {
        statusCode: number;
      };
      err.statusCode = 502;
      throw err;
    });
    const res = await app.inject({ method: "GET", url: "/__test_bad_gateway" });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "internal_error" });
    await app.close();
    await closeDb();
  });

  it("keeps explicit 4xx error messages intact", async () => {
    const app = await buildApp();
    app.get("/__test_teapot", async () => {
      const err = new Error("not a teapot after all") as Error & { statusCode: number };
      err.statusCode = 418;
      throw err;
    });
    const res = await app.inject({ method: "GET", url: "/__test_teapot" });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: "not a teapot after all" });
    await app.close();
    await closeDb();
  });
});

describe("malformed ids (Postgres 22P02, invalid text representation)", () => {
  const ISSUER = "https://auth.test/application/o/portfolio/";
  const AUDIENCE = "portfolio-tracker";
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 400 invalid_input instead of a 500 when an id isn't a UUID", async () => {
    const kp = await generateKeyPair("ES256");
    vi.stubEnv("AUTHENTIK_ISSUER", ISSUER);
    vi.stubEnv("AUTHENTIK_AUDIENCE", AUDIENCE);
    vi.stubEnv("RATE_LIMIT_MAX", "10000");
    const app = await buildApp({ authKey: kp.publicKey });
    const token = await new SignJWT({ email: "bad-id@example.com" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("bad-id")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(kp.privateKey);
    const headers = { authorization: `Bearer ${token}` };
    for (const url of [
      "/networth/trades?holderId=__id_all_portfolios__",
      "/networth/tax?holderId=not-a-uuid",
      "/networth?holderId=not-a-uuid",
      "/networth/income?holderId=not-a-uuid",
      "/networth/history?holderId=not-a-uuid",
      "/networth/contributions?holderId=not-a-uuid",
      "/networth/gold?holderId=not-a-uuid",
      "/networth/sparplan?holderId=not-a-uuid",
      "/portfolios/not-a-uuid/tax",
    ]) {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode, url).toBe(400);
      expect(res.json(), url).toEqual({ error: "invalid_input" });
    }
    await app.close();
    await closeDb();
  });

  it("maps a driver error carrying code 22P02 (directly or as the cause) to 400", async () => {
    const app = await buildApp();
    app.get("/__test_bad_uuid_cause", async () => {
      throw Object.assign(new Error("Failed query: select …"), {
        cause: Object.assign(new Error('invalid input syntax for type uuid: "x"'), {
          code: "22P02",
        }),
      });
    });
    app.get("/__test_bad_uuid_direct", async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code: "22P02" });
    });
    app.get("/__test_bad_numeric", async () => {
      throw Object.assign(new Error("Failed query: select …"), {
        cause: Object.assign(new Error('invalid input syntax for type numeric: "abc"'), {
          code: "22P02",
        }),
      });
    });
    for (const url of [
      "/__test_bad_uuid_cause",
      "/__test_bad_uuid_direct",
      "/__test_bad_numeric",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(400);
      // The driver text (column types, the value) is not echoed.
      expect(res.json(), url).toEqual({ error: "invalid_input" });
    }
    await app.close();
    await closeDb();
  });

  it("stops looking for the code after 3 levels of cause (deeper stays a 500)", async () => {
    const app = await buildApp();
    app.get("/__test_deep_cause", async () => {
      const pg = Object.assign(new Error("invalid input syntax"), { code: "22P02" });
      const wrap = (cause: Error) => Object.assign(new Error("wrapped"), { cause });
      throw wrap(wrap(wrap(pg))); // the code sits on the 4th error of the chain
    });
    app.get("/__test_third_level", async () => {
      const pg = Object.assign(new Error("invalid input syntax"), { code: "22P02" });
      const wrap = (cause: Error) => Object.assign(new Error("wrapped"), { cause });
      throw wrap(wrap(pg)); // 3rd error of the chain: still found
    });
    expect((await app.inject({ method: "GET", url: "/__test_deep_cause" })).statusCode).toBe(500);
    expect((await app.inject({ method: "GET", url: "/__test_third_level" })).statusCode).toBe(400);
    await app.close();
    await closeDb();
  });
});
