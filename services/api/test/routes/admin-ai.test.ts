import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq, like, sql } from "drizzle-orm";
import {
  adminAuditLog,
  aiProviderSettings,
  aiTaskSettings,
  providerCredentials,
} from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { getChatProvider, resolveScreenshotParser } from "../../src/services/ai/resolve.js";
import { seedAiTaskSettings } from "../../src/services/ai/seed.js";
import { clearModelCache } from "../../src/services/ai/models.js";

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
  authorization: `Bearer ${await token("ai-admin", [ADMIN_GROUP])}`,
});

interface View {
  connections: {
    id: string;
    configured: boolean;
    hasKey: boolean;
    keyHint: string | null;
    hasUrl: boolean;
    keySource: "db" | "env" | null;
    local: boolean | null;
    allowDataCollection: boolean | null;
  }[];
  tasks: {
    task: "vision" | "chat";
    provider: string | null;
    model: string | null;
    effort: string | null;
    usable: boolean;
  }[];
  encryptionEnabled: boolean;
}

const ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_VISION_MODEL",
  "ANTHROPIC_CHAT_MODEL",
  "ANTHROPIC_CHAT_EFFORT",
  "GEMINI_API_KEY",
  "GEMINI_CHAT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_CHAT_MODEL",
  "OPENROUTER_ALLOW_DATA_COLLECTION",
  "OLLAMA_BASE_URL",
  "OLLAMA_CHAT_MODEL",
  "SCREENSHOT_PARSER",
  "CHAT_PROVIDER",
];

describe("admin AI providers", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
    process.env.RATE_LIMIT_MAX = "10000";
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64url");
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
      "DB_ENCRYPTION_KEY",
    ])
      delete process.env[k];
  });
  beforeEach(() => {
    // The DB-backed path (tests normally select from env only).
    vi.stubEnv("NODE_ENV", "development");
    for (const k of ENV) vi.stubEnv(k, "");
    clearModelCache();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    const db = getDb();
    await db.delete(aiTaskSettings);
    await db.delete(aiProviderSettings);
    await db.delete(providerCredentials).where(like(providerCredentials.provider, "ai:%"));
    await db.delete(providerCredentials).where(like(providerCredentials.provider, "vision:%"));
  });

  const call = async (method: "GET" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, headers: await adminHeaders(), ...(payload ? { payload } : {}) });
  const view = async () => (await call("GET", "/admin/ai")).json() as View;
  const task = (v: View, name: "vision" | "chat") => v.tasks.find((t) => t.task === name)!;

  it("is admin only", async () => {
    const user = { authorization: `Bearer ${await token("plain-user")}` };
    for (const [method, url] of [
      ["GET", "/admin/ai"],
      ["PATCH", "/admin/ai/tasks/chat"],
      ["PATCH", "/admin/ai/providers/openrouter"],
      ["PUT", "/admin/ai/providers/claude/credential"],
      ["DELETE", "/admin/ai/providers/claude/credential"],
      ["GET", "/admin/ai/providers/claude/models?task=chat"],
    ] as const) {
      const res = await app.inject({ method, url, headers: user, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  describe("connections", () => {
    it("stores a key encrypted, shows only a hint, and clears it", async () => {
      const put = await call("PUT", "/admin/ai/providers/gemini/credential", {
        apiKey: "AIza-secret-1234", // pragma: allowlist secret
      });
      expect(put.statusCode).toBe(200);
      expect(put.body).not.toContain("AIza-secret-1234"); // pragma: allowlist secret
      expect(put.json<View>().connections.find((c) => c.id === "gemini")).toMatchObject({
        configured: true,
        hasKey: true,
        keyHint: "••••1234",
        keySource: "db",
      });

      const [row] = await getDb()
        .select()
        .from(providerCredentials)
        .where(eq(providerCredentials.provider, "ai:gemini"));
      expect(row!.apiKeyEnc).toMatch(/^enc:/); // namespaced `ai:`, never plaintext
      expect(row!.apiKeyEnc).not.toContain("AIza"); // pragma: allowlist secret

      const del = await call("DELETE", "/admin/ai/providers/gemini/credential");
      expect(del.json<View>().connections.find((c) => c.id === "gemini")).toMatchObject({
        configured: false,
        hasKey: false,
        keySource: null,
      });
    });

    it("reports a key that only the env supplies, and Ollama's locality", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "env-key"); // pragma: allowlist secret
      const put = await call("PUT", "/admin/ai/providers/ollama/credential", {
        urlOverride: "http://ollama:11434",
      });
      const v = put.json<View>();
      expect(v.connections.find((c) => c.id === "claude")).toMatchObject({
        configured: true,
        hasKey: false,
        keySource: "env",
        local: null,
      });
      expect(v.connections.find((c) => c.id === "ollama")).toMatchObject({
        configured: true,
        hasUrl: true,
        keySource: "db",
        local: true,
      });
    });

    it("rejects unknown providers and empty credentials", async () => {
      expect(
        (await call("PUT", "/admin/ai/providers/nope/credential", { apiKey: "k" })).statusCode,
      ).toBe(404);
      expect((await call("PUT", "/admin/ai/providers/claude/credential", {})).statusCode).toBe(400);
    });

    it("sets OpenRouter's data-collection switch (only OpenRouter has options)", async () => {
      const on = await call("PATCH", "/admin/ai/providers/openrouter", {
        allowDataCollection: true,
      });
      expect(
        on.json<View>().connections.find((c) => c.id === "openrouter")!.allowDataCollection,
      ).toBe(true);
      const cleared = await call("PATCH", "/admin/ai/providers/openrouter", {
        allowDataCollection: null,
      });
      expect(
        cleared.json<View>().connections.find((c) => c.id === "openrouter")!.allowDataCollection,
      ).toBe(false); // cleared = the default: deny
      expect(
        (await call("PATCH", "/admin/ai/providers/claude", { allowDataCollection: true }))
          .statusCode,
      ).toBe(400);
      expect((await call("PATCH", "/admin/ai/providers/nope", {})).statusCode).toBe(404);
    });
  });

  describe("tasks", () => {
    it("rejects an unknown task, provider, missing model, or unconfigured provider", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "k"); // pragma: allowlist secret
      expect((await call("PATCH", "/admin/ai/tasks/speech", { provider: null })).statusCode).toBe(
        404,
      );
      expect(
        (await call("PATCH", "/admin/ai/tasks/chat", { provider: "nope", model: "m" })).json(),
      ).toMatchObject({ error: "unknown_provider" });
      expect(
        (await call("PATCH", "/admin/ai/tasks/chat", { provider: "openrouter" })).json(),
      ).toMatchObject({ error: "model_required" });
      expect(
        (await call("PATCH", "/admin/ai/tasks/chat", { provider: "gemini", model: "m" })).json(),
      ).toMatchObject({ error: "provider_not_configured" });
      expect(await getDb().select().from(aiTaskSettings)).toHaveLength(0);
    });

    it("applies a vision change to the next import, with no restart", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "a"); // pragma: allowlist secret
      vi.stubEnv("OPENROUTER_API_KEY", "o"); // pragma: allowlist secret
      // Env keys alone select nothing at runtime: only a stored setting does.
      expect((await resolveScreenshotParser()).isConfigured()).toBe(false);

      const patched = await call("PATCH", "/admin/ai/tasks/vision", {
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
      });
      expect(task(patched.json<View>(), "vision")).toMatchObject({
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        usable: true,
      });
      const parser = await resolveScreenshotParser();
      expect(parser.name).toBe("openrouter");
      expect(parser.isConfigured()).toBe(true);

      await call("PATCH", "/admin/ai/tasks/vision", { provider: null });
      const off = await resolveScreenshotParser();
      expect(off.isConfigured()).toBe(false); // explicitly off ≠ "fall back to env"
    });

    it("names the selected provider, not claude, when a vision task has no model", async () => {
      await getDb()
        .insert(aiTaskSettings)
        .values({ task: "vision", provider: "gemini", model: null });
      const parser = await resolveScreenshotParser();
      expect(parser.name).toBe("gemini");
      expect(parser.isConfigured()).toBe(false);
    });

    it("OpenRouter data collection: a stored option decides (null = deny), the env var only applies before one exists", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "o"); // pragma: allowlist secret
      vi.stubEnv("OPENROUTER_ALLOW_DATA_COLLECTION", "true");
      await call("PATCH", "/admin/ai/tasks/chat", { provider: "openrouter", model: "some/model" });
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
        );
      });
      const ask = async () =>
        (await getChatProvider())!.complete({ system: "s", messages: [], tools: [], maxTokens: 1 });

      await ask(); // no stored option yet: the env opt-out applies
      await call("PATCH", "/admin/ai/providers/openrouter", { allowDataCollection: null });
      await ask(); // stored null = the default, deny, whatever the env says
      expect(bodies[0]!.provider).toBeUndefined();
      expect(bodies[1]!.provider).toEqual({ data_collection: "deny" });
      expect(
        (await view()).connections.find((c) => c.id === "openrouter")!.allowDataCollection,
      ).toBe(false); // the page shows what actually applies
    });

    it("applies a chat change, keeps effort for Claude chat only, and off means unavailable", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "a"); // pragma: allowlist secret
      vi.stubEnv("OPENROUTER_API_KEY", "o"); // pragma: allowlist secret
      const claude = await call("PATCH", "/admin/ai/tasks/chat", {
        provider: "claude",
        model: "claude-opus-5-5",
        effort: "high",
      });
      expect(task(claude.json<View>(), "chat")).toMatchObject({
        provider: "claude",
        effort: "high",
      });
      expect((await getChatProvider())?.name).toBe("claude");

      const openrouter = await call("PATCH", "/admin/ai/tasks/chat", {
        provider: "openrouter",
        model: "some/model",
        effort: "high",
      });
      expect(task(openrouter.json<View>(), "chat")).toMatchObject({
        provider: "openrouter",
        model: "some/model",
        effort: null,
      });
      expect((await getChatProvider())?.name).toBe("openrouter");

      await call("PATCH", "/admin/ai/tasks/chat", { provider: null });
      expect(await getChatProvider()).toBeNull();
    });

    it("marks a task unusable once its credential is removed", async () => {
      await call("PUT", "/admin/ai/providers/openrouter/credential", { apiKey: "or-key" }); // pragma: allowlist secret
      await call("PATCH", "/admin/ai/tasks/chat", { provider: "openrouter", model: "m" });
      expect(task(await view(), "chat").usable).toBe(true);
      await call("DELETE", "/admin/ai/providers/openrouter/credential");
      expect(task(await view(), "chat")).toMatchObject({ provider: "openrouter", usable: false });
      expect(await getChatProvider()).toBeNull();
    });

    it("writes an audit entry per change", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "o"); // pragma: allowlist secret
      await call("PATCH", "/admin/ai/tasks/vision", { provider: "openrouter", model: "m" });
      await call("PUT", "/admin/ai/providers/claude/credential", { apiKey: "sk-ant-1234" }); // pragma: allowlist secret
      const rows = await getDb().select().from(adminAuditLog);
      const actions = rows.map((r) => `${r.action}:${r.target}`);
      expect(actions).toContain("update_ai_task:vision");
      expect(actions).toContain("set_credential:ai:claude");
      expect(JSON.stringify(rows)).not.toContain("sk-ant-1234"); // pragma: allowlist secret
    });
  });

  describe("models", () => {
    const openRouterList = () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "x/tools",
              name: "Tools",
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["tools"],
            },
            {
              id: "x/vision",
              name: "Vision",
              architecture: { input_modalities: ["image"] },
              supported_parameters: [],
            },
          ],
        }),
      );

    it("lists a provider's models for a task, with the stored credential", async () => {
      await call("PUT", "/admin/ai/providers/openrouter/credential", { apiKey: "or-secret" }); // pragma: allowlist secret
      const seen: (string | undefined)[] = [];
      vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
        seen.push((init?.headers as Record<string, string> | undefined)?.authorization);
        return openRouterList();
      });
      const chat = await call("GET", "/admin/ai/providers/openrouter/models?task=chat");
      expect(chat.json().models.map((m: { id: string }) => m.id)).toEqual(["x/tools"]);
      const vision = await call("GET", "/admin/ai/providers/openrouter/models?task=vision");
      expect(vision.json().models.map((m: { id: string }) => m.id)).toEqual(["x/vision"]);
      expect(seen[0]).toBe("Bearer or-secret");
    });

    it("answers a provider failure with 200 + an error code, and validates its input", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "o"); // pragma: allowlist secret
      vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
      const res = await call("GET", "/admin/ai/providers/openrouter/models?task=chat");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ models: [], error: "provider_http_401" });

      expect((await call("GET", "/admin/ai/providers/nope/models?task=chat")).statusCode).toBe(404);
      expect((await call("GET", "/admin/ai/providers/openrouter/models?task=x")).statusCode).toBe(
        400,
      );
      expect((await call("GET", "/admin/ai/providers/openrouter/models")).statusCode).toBe(400);
    });
  });

  describe("first-boot seed", () => {
    const rows = () => getDb().select().from(aiTaskSettings);

    it("freezes what env selected, so nothing changes on upgrade", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "a"); // pragma: allowlist secret
      vi.stubEnv("GEMINI_API_KEY", "g"); // pragma: allowlist secret
      const { seeded } = await seedAiTaskSettings(getDb());
      expect(seeded.sort()).toEqual(["chat", "vision"]);
      const byTask = Object.fromEntries((await rows()).map((r) => [r.task, r]));
      expect(byTask.vision).toMatchObject({ provider: "claude", model: "claude-sonnet-4-6" });
      expect(byTask.chat).toMatchObject({ provider: "claude", model: "claude-opus-5-5" });

      // Later env edits no longer move the selection.
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(task(await view(), "vision")).toMatchObject({ provider: "claude", usable: false });
    });

    it("does not start answering chat from a Gemini vision key", async () => {
      vi.stubEnv("GEMINI_API_KEY", "g"); // pragma: allowlist secret
      await seedAiTaskSettings(getDb());
      const byTask = Object.fromEntries((await rows()).map((r) => [r.task, r]));
      expect(byTask.vision).toMatchObject({ provider: "gemini" });
      expect(byTask.chat).toBeUndefined();
      expect(await getChatProvider()).toBeNull();
    });

    it("keeps a pinned-or-nothing chat pin, even to a provider that isn't usable", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "a"); // pragma: allowlist secret
      vi.stubEnv("CHAT_PROVIDER", "ollama");
      await seedAiTaskSettings(getDb());
      expect(task(await view(), "chat")).toMatchObject({ provider: "ollama", usable: false });
      expect(await getChatProvider()).toBeNull();
    });

    it("never overwrites a stored setting (including an explicit off) and seeds nothing when unconfigured", async () => {
      expect((await seedAiTaskSettings(getDb())).seeded).toEqual([]); // nothing configured
      expect(await rows()).toHaveLength(0);

      vi.stubEnv("ANTHROPIC_API_KEY", "a"); // pragma: allowlist secret
      await getDb().insert(aiTaskSettings).values({ task: "chat", provider: null });
      await seedAiTaskSettings(getDb());
      const byTask = Object.fromEntries((await rows()).map((r) => [r.task, r]));
      expect(byTask.chat).toMatchObject({ provider: null }); // still off
      expect(byTask.vision).toMatchObject({ provider: "claude" });
    });

    it("fails closed: with no stored setting, env keys alone never switch a provider on", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "a"); // pragma: allowlist secret
      expect(await getChatProvider()).toBeNull();
      expect((await resolveScreenshotParser()).isConfigured()).toBe(false);
      expect((await view()).tasks.every((t) => t.provider === null)).toBe(true);
    });

    it("carries the env data-collection opt-out into the stored option", async () => {
      vi.stubEnv("OPENROUTER_ALLOW_DATA_COLLECTION", "true");
      await seedAiTaskSettings(getDb());
      expect(
        (await view()).connections.find((c) => c.id === "openrouter")!.allowDataCollection,
      ).toBe(true);
    });
  });

  it("migration 0100 moves stored credentials from the vision: to the ai: namespace unchanged", async () => {
    const file = readFileSync(
      new URL("../../../../packages/db/drizzle/0100_graceful_mantis.sql", import.meta.url),
      "utf8",
    );
    const statement = file
      .split("--> statement-breakpoint")
      .map((p) => p.replace(/^\s*--.*$/gm, "").trim())
      .find((p) => p.startsWith("UPDATE"))!;
    expect(statement).toBeTruthy();

    const db = getDb();
    await db.insert(providerCredentials).values([
      { provider: "vision:gemini", apiKeyEnc: "enc:abc" }, // pragma: allowlist secret
      { provider: "vision:ollama", urlOverride: "http://ollama:11434" },
      { provider: "coingecko", apiKeyEnc: "enc:market-data" }, // pragma: allowlist secret; a market-data provider: untouched
    ]);
    try {
      await db.execute(sql.raw(statement));
      const all = await db.select().from(providerCredentials);
      const by = Object.fromEntries(all.map((r) => [r.provider, r]));
      expect(by["ai:gemini"]).toMatchObject({ apiKeyEnc: "enc:abc" }); // pragma: allowlist secret
      expect(by["ai:ollama"]).toMatchObject({ urlOverride: "http://ollama:11434" });
      expect(by["vision:gemini"]).toBeUndefined();
      expect(by["coingecko"]).toMatchObject({ apiKeyEnc: "enc:market-data" }); // pragma: allowlist secret
    } finally {
      await db.delete(providerCredentials).where(eq(providerCredentials.provider, "coingecko"));
    }
  });

  const legacyTables = async () => {
    const res = await getDb().execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_name IN ('vision_provider_settings','chat_provider_settings','chat_settings')`,
    );
    // PGlite returns `{ rows }`, postgres-js a bare array.
    return (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
  };

  it("migration 0101 is applied by the real migrator: the legacy tables are gone from a migrated database", async () => {
    // `buildApp()` ran every journal entry in `beforeAll`: if 0101 were missing from
    // `meta/_journal.json` (or its tag mismatched) the migrator would skip it and these would exist.
    expect(await legacyTables()).toHaveLength(0);
  });

  it("migration 0101 drops the three legacy tables and leaves ai_task_settings alone", async () => {
    const file = readFileSync(
      new URL("../../../../packages/db/drizzle/0101_furry_polaris.sql", import.meta.url),
      "utf8",
    );
    const statements = file
      .split("--> statement-breakpoint")
      .map((p) => p.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements.every((st) => st.startsWith("DROP TABLE"))).toBe(true);

    const db = getDb();
    await db.insert(aiTaskSettings).values({ task: "chat", provider: "claude", model: "m" });
    // Recreate the three tables as an upgrading database has them, then run the statements.
    await db.execute(sql`CREATE TABLE vision_provider_settings (provider text)`);
    await db.execute(sql`CREATE TABLE chat_provider_settings (provider text)`);
    await db.execute(sql`CREATE TABLE chat_settings (id integer)`);
    try {
      expect(await legacyTables()).toHaveLength(3);
      for (const st of statements) await db.execute(sql.raw(st));
      expect(await legacyTables()).toHaveLength(0);
    } finally {
      // Never leave the recreated tables behind: against a persistent database the next run
      // (and the "gone from a migrated database" test) would otherwise fail on order alone.
      await db.execute(sql`DROP TABLE IF EXISTS vision_provider_settings`);
      await db.execute(sql`DROP TABLE IF EXISTS chat_provider_settings`);
      await db.execute(sql`DROP TABLE IF EXISTS chat_settings`);
    }
    expect(await db.select().from(aiTaskSettings)).toMatchObject([
      { task: "chat", provider: "claude", model: "m" },
    ]);
  });
});
