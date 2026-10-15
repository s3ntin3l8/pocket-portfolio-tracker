import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import {
  adminAuditLog,
  chatProviderSettings,
  chatSettings,
  visionProviderSettings,
} from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { getChatProvider } from "../../src/services/chat/registry.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
const ADMIN_GROUP = "portfolio-admins";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string, groups?: string[]) {
  return new SignJWT({ email: `${sub}@example.com`, ...(groups ? { groups } : {}) })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const adminHeaders = async () => ({
  authorization: `Bearer ${await token("chat-admin", [ADMIN_GROUP])}`,
});

interface View {
  providers: {
    id: string;
    enabled: boolean;
    enabledSource: string;
    priority: number;
    model: string | null;
    modelSource: string | null;
    modelEnvVar: string;
    configured: boolean;
  }[];
  pinned: string | null;
  pinnedSource: string | null;
  activeProvider: string | null;
}

describe("admin chat provider settings", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
    for (const k of [
      "AUTHENTIK_ISSUER",
      "AUTHENTIK_AUDIENCE",
      "AUTHENTIK_ADMIN_GROUP",
      "RATE_LIMIT_MAX",
    ])
      delete process.env[k];
  });
  beforeEach(() => {
    // The DB-backed selection path (tests normally use env-only selection).
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "k"); // pragma: allowlist secret
    vi.stubEnv("OPENROUTER_API_KEY", "k"); // pragma: allowlist secret
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "env/model");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    const db = getDb();
    await db.delete(chatProviderSettings);
    await db.delete(chatSettings);
    await db.delete(visionProviderSettings);
  });

  const get = async () =>
    app.inject({ method: "GET", url: "/admin/chat-providers", headers: await adminHeaders() });
  const patch = async (payload: unknown) =>
    app.inject({
      method: "PATCH",
      url: "/admin/chat-providers",
      headers: await adminHeaders(),
      payload: payload as object,
    });

  it("is admin only", async () => {
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: "/admin/chat-providers",
        headers: { authorization: `Bearer ${await token("not-admin")}` },
        payload: method === "PATCH" ? { providers: [] } : undefined,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("lists every provider with its effective settings, sources and the active provider", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const v = res.json() as View;
    expect(v.providers.map((p) => p.id).sort()).toEqual([
      "claude",
      "gemini",
      "ollama",
      "openrouter",
    ]);
    expect(v.providers.find((p) => p.id === "claude")).toMatchObject({
      model: "claude-opus-5-5",
      modelSource: "default",
      enabledSource: "vision",
      modelEnvVar: "ANTHROPIC_CHAT_MODEL",
      configured: true,
    });
    expect(v.providers.find((p) => p.id === "openrouter")).toMatchObject({
      model: "env/model",
      modelSource: "env",
    });
    expect(v.providers.find((p) => p.id === "gemini")?.configured).toBe(false);
    expect(v.pinned).toBeNull();
    expect(v.activeProvider).toBe("claude");
  });

  it("stores a model and chat-only priority, and the next chat uses them", async () => {
    const res = await patch({
      providers: [
        { id: "openrouter", enabled: true, priority: 0, model: "  admin/model " },
        { id: "claude", model: "claude-custom" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const v = res.json() as View;
    expect(v.providers[0]).toMatchObject({
      id: "openrouter",
      model: "admin/model",
      modelSource: "db",
      enabledSource: "chat",
    });
    expect(v.providers.find((p) => p.id === "claude")).toMatchObject({
      model: "claude-custom",
      modelSource: "db",
      enabledSource: "vision", // untouched fields stay inherited
    });
    expect(v.activeProvider).toBe("openrouter");
    expect((await getChatProvider())?.name).toBe("openrouter");

    // The vision settings were not touched by any of this.
    expect(await getDb().select().from(visionProviderSettings)).toHaveLength(0);
  });

  it("null clears an override back to inheriting", async () => {
    await patch({ providers: [{ id: "claude", enabled: false, model: "x" }] });
    expect(((await get()).json() as View).activeProvider).toBe("openrouter");
    const res = await patch({ providers: [{ id: "claude", enabled: null, model: null }] });
    const claude = (res.json() as View).providers.find((p) => p.id === "claude");
    expect(claude).toMatchObject({ enabledSource: "vision", modelSource: "default" });
    expect((res.json() as View).activeProvider).toBe("claude");
  });

  it("pins a provider (beats the env var, never falls through) and unpins with null", async () => {
    vi.stubEnv("CHAT_PROVIDER", "claude");
    expect((await get()).json() as View).toMatchObject({ pinned: "claude", pinnedSource: "env" });

    const pinned = (await patch({ pinned: "openrouter" })).json() as View;
    expect(pinned).toMatchObject({
      pinned: "openrouter",
      pinnedSource: "db",
      activeProvider: "openrouter",
    });
    expect((await getChatProvider())?.name).toBe("openrouter");

    // Pinned to something unusable: chat is unavailable, not rerouted to claude.
    const dead = (await patch({ pinned: "ollama" })).json() as View;
    expect(dead.activeProvider).toBeNull();
    expect(await getChatProvider()).toBeNull();

    const cleared = (await patch({ pinned: null })).json() as View;
    expect(cleared).toMatchObject({ pinned: "claude", pinnedSource: "env" }); // env fallback
  });

  it("rejects unknown provider ids and bad input", async () => {
    const unknown = await patch({ providers: [{ id: "nope", enabled: true }] });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ error: "unknown_provider", ids: ["nope"] });
    expect((await patch({ pinned: "nope" })).statusCode).toBe(400);
    expect((await patch({ providers: [{ id: "claude", priority: -1 }] })).statusCode).toBe(400);
  });

  it("writes an audit entry, and DELETE resets everything", async () => {
    await patch({ providers: [{ id: "claude", model: "m" }], pinned: "claude" });
    const audit = await getDb().select().from(adminAuditLog);
    expect(audit.some((a) => a.action === "update_chat_providers")).toBe(true);

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/chat-providers",
      headers: await adminHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pinned: null });
    expect(await getDb().select().from(chatProviderSettings)).toHaveLength(0);
    expect(await getDb().select().from(chatSettings)).toHaveLength(0);
    expect(
      (await getDb().select().from(adminAuditLog)).some((a) => a.action === "reset_chat_providers"),
    ).toBe(true);
  });
});
