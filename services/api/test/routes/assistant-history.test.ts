/**
 * Opt-in assistant history: nothing is stored unless the user turned it on; only the text of
 * completed turns is; per-user isolation; caps; retention; turning it off deletes everything.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { assistantConversations, assistantMessages, users } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";
import {
  MAX_CONVERSATIONS,
  MAX_CONVERSATION_MESSAGES,
  RETENTION_DAYS,
  purgeExpiredConversations,
  saveTurn,
} from "../../src/services/assistant-history.js";
import type { ChatProvider, ChatResult } from "../../src/services/chat/types.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;
let alice: string;
let bob: string;
let turns: (ChatResult | Error)[] = [];

async function jwt(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const endTurn = (text: string): ChatResult => ({ text, toolCalls: [], stop: "end" });

const model: ChatProvider = {
  name: "fake",
  label: "Fake",
  local: true,
  isConfigured: () => true,
  async complete() {
    const t = turns.shift() ?? endTurn("ok");
    if (t instanceof Error) throw t;
    return t;
  },
};

interface Sse {
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}
const parseSse = (body: string): Sse[] =>
  body
    .split("\n\n")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(":"))
    .map((c) => ({
      event: /^event: (.*)$/m.exec(c)![1]!,
      data: JSON.parse(/^data: (.*)$/m.exec(c)![1]!),
    }));

const chat = (token: string, content: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/assistant/chat",
    headers: { ...auth(token), "content-type": "application/json" },
    payload: { messages: [{ role: "user", content }], ...extra },
  });
const setHistory = (token: string, on: boolean) =>
  app.inject({
    method: "PUT",
    url: "/me/preferences",
    headers: auth(token),
    payload: { assistantSaveHistory: on },
  });
const list = async (token: string) =>
  (
    await app.inject({ method: "GET", url: "/assistant/conversations", headers: auth(token) })
  ).json().conversations as { id: string; title: string; messageCount: number }[];
const userId = async (sub: string) =>
  (await getDb().select({ id: users.id }).from(users).where(eq(users.authSub, sub)))[0]!.id;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  process.env.ASSISTANT_RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey, chatProvider: model });
  alice = await jwt("hist-alice");
  bob = await jwt("hist-bob");
  // First request creates the user rows.
  await app.inject({ method: "GET", url: "/me", headers: auth(alice) });
  await app.inject({ method: "GET", url: "/me", headers: auth(bob) });
});
afterAll(async () => {
  await app.close();
  await closeDb();
});
beforeEach(async () => {
  turns = [];
  await getDb().delete(assistantConversations);
  await setHistory(alice, false);
  await setHistory(bob, false);
});

describe("preference", () => {
  it("is off by default and reflected on /me/preferences and /assistant/status", async () => {
    const prefs = await app.inject({ method: "GET", url: "/me/preferences", headers: auth(alice) });
    expect(prefs.json().assistantSaveHistory).toBe(false);
    await setHistory(alice, true);
    expect(
      (await app.inject({ method: "GET", url: "/me/preferences", headers: auth(alice) })).json(),
    ).toMatchObject({ assistantSaveHistory: true });
    const status = await app.inject({
      method: "GET",
      url: "/assistant/status",
      headers: auth(alice),
    });
    expect(status.json().saveHistory).toBe(true);
    const bobStatus = await app.inject({
      method: "GET",
      url: "/assistant/status",
      headers: auth(bob),
    });
    expect(bobStatus.json().saveHistory).toBe(false);
  });

  it("deletes everything stored when it is turned off", async () => {
    await setHistory(alice, true);
    await chat(alice, "first question");
    await chat(bob, "bob is not opted in");
    expect(await list(alice)).toHaveLength(1);
    const off = await setHistory(alice, false);
    expect(off.json().assistantSaveHistory).toBe(false);
    expect(await list(alice)).toHaveLength(0);
    expect(await getDb().select().from(assistantMessages)).toHaveLength(0);
  });
});

describe("POST /assistant/chat with history", () => {
  it("stores nothing for a user who did not opt in", async () => {
    turns = [endTurn("answer")];
    const res = await chat(alice, "private question");
    expect(parseSse(res.body).map((e) => e.event)).toEqual(["status", "message", "done"]);
    expect(await getDb().select().from(assistantConversations)).toHaveLength(0);
  });

  it("stores the text of a completed turn, announces the conversation before done, and appends to it", async () => {
    await setHistory(alice, true);
    turns = [endTurn("Your net worth is up.")];
    const first = parseSse((await chat(alice, "How am I doing?")).body);
    expect(first.map((e) => e.event)).toEqual(["status", "message", "conversation", "done"]);
    const { id, saved } = first.find((e) => e.event === "conversation")!.data;
    expect(saved).toBe(true);

    turns = [endTurn("Mostly equities.")];
    const second = parseSse((await chat(alice, "What drives it?", { conversationId: id })).body);
    expect(second.find((e) => e.event === "conversation")!.data.id).toBe(id);

    const convs = await list(alice);
    expect(convs).toMatchObject([{ id, title: "How am I doing?", messageCount: 4 }]);
    const detail = await app.inject({
      method: "GET",
      url: `/assistant/conversations/${id}`,
      headers: auth(alice),
    });
    expect(detail.json().messages).toEqual([
      { role: "user", content: "How am I doing?" },
      { role: "assistant", content: "Your net worth is up." },
      { role: "user", content: "What drives it?" },
      { role: "assistant", content: "Mostly equities." },
    ]);
  });

  it("stores only text: no tool inputs or results", async () => {
    await setHistory(alice, true);
    turns = [
      { text: "", toolCalls: [{ id: "t1", name: "list_portfolios", args: {} }], stop: "tool_use" },
      endTurn("You have no portfolios yet."),
    ];
    const res = parseSse((await chat(alice, "list them")).body);
    expect(res.some((e) => e.event === "tool_call")).toBe(true);
    const rows = await getDb().select().from(assistantMessages);
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ["user", "list them"],
      ["assistant", "You have no portfolios yet."],
    ]);
  });

  it("does not store a turn that failed or produced no text, and never emits conversation", async () => {
    await setHistory(alice, true);
    turns = [endTurn("")];
    const empty = parseSse((await chat(alice, "hello?")).body);
    expect(empty.map((e) => e.event)).toEqual(["status", "done"]);
    turns = [new Error("boom")];
    const failed = parseSse((await chat(alice, "hello again")).body);
    expect(failed.map((e) => e.event)).toEqual(["status", "error"]);
    expect(await getDb().select().from(assistantConversations)).toHaveLength(0);
  });

  it("never stores for a read-only token, even when the user opted in", async () => {
    await setHistory(alice, true);
    const mint = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(alice),
      payload: { name: "ro", scope: "read" },
    });
    const pat = mint.json().token as string;
    turns = [endTurn("fine")];
    const events = parseSse((await chat(pat, "from a read-only token")).body).map((e) => e.event);
    expect(events).toEqual(["status", "message", "done"]);
    expect(await getDb().select().from(assistantConversations)).toHaveLength(0);
    const status = await app.inject({
      method: "GET",
      url: "/assistant/status",
      headers: auth(pat),
    });
    expect(status.json().saveHistory).toBe(false);
  });

  it("starts a new conversation when the id is unknown or belongs to someone else", async () => {
    await setHistory(alice, true);
    await setHistory(bob, true);
    turns = [endTurn("bob's answer")];
    const bobs = parseSse((await chat(bob, "bob question")).body).find(
      (e) => e.event === "conversation",
    )!.data.id as string;

    turns = [endTurn("alice's answer")];
    const res = parseSse((await chat(alice, "alice question", { conversationId: bobs })).body);
    const aliceId = res.find((e) => e.event === "conversation")!.data.id;
    expect(aliceId).not.toBe(bobs);
    expect(await list(bob)).toMatchObject([{ id: bobs, messageCount: 2 }]);

    turns = [endTurn("stale")];
    const stale = parseSse(
      (await chat(alice, "q", { conversationId: "00000000-0000-4000-8000-000000000000" })).body,
    );
    expect(stale.find((e) => e.event === "conversation")!.data.id).not.toBe(
      "00000000-0000-4000-8000-000000000000",
    );
  });

  it("rejects a malformed conversation id", async () => {
    const res = await chat(alice, "x", { conversationId: "not-a-uuid" });
    expect(res.statusCode).toBe(400);
  });
});

describe("conversation routes", () => {
  it("lists, reads and deletes only the caller's conversations", async () => {
    await setHistory(alice, true);
    await setHistory(bob, true);
    turns = [endTurn("a")];
    const a = parseSse((await chat(alice, "alice q")).body).find((e) => e.event === "conversation")!
      .data.id as string;
    turns = [endTurn("b")];
    await chat(bob, "bob q");

    expect(await list(alice)).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/assistant/conversations/${a}`,
          headers: auth(bob),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/assistant/conversations/${a}`,
          headers: auth(bob),
        })
      ).statusCode,
    ).toBe(404);
    expect(await list(alice)).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/assistant/conversations/not-a-uuid",
          headers: auth(alice),
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/assistant/conversations/${a}`,
          headers: auth(alice),
        })
      ).statusCode,
    ).toBe(204);
    expect(await list(alice)).toHaveLength(0);
    expect(await list(bob)).toHaveLength(1);
  });

  it("requires authentication, and delete-all only touches the caller", async () => {
    expect((await app.inject({ method: "GET", url: "/assistant/conversations" })).statusCode).toBe(
      401,
    );
    await setHistory(alice, true);
    await setHistory(bob, true);
    turns = [endTurn("a")];
    await chat(alice, "q1");
    turns = [endTurn("b")];
    await chat(bob, "q2");
    const res = await app.inject({
      method: "DELETE",
      url: "/assistant/conversations",
      headers: auth(alice),
    });
    expect(res.json()).toEqual({ deleted: 1 });
    expect(await list(bob)).toHaveLength(1);
  });

  it("a read-only token cannot delete", async () => {
    const mint = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(alice),
      payload: { name: "ro2", scope: "read" },
    });
    const pat = mint.json().token as string;
    const res = await app.inject({
      method: "DELETE",
      url: "/assistant/conversations",
      headers: auth(pat),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("caps and retention", () => {
  beforeEach(async () => {
    await setHistory(alice, true);
  });

  it("keeps only the newest conversations per user", async () => {
    const uid = await userId("hist-alice");
    const db = getDb();
    for (let i = 0; i < MAX_CONVERSATIONS; i++) {
      await saveTurn(db, uid, { user: `q${i}`, assistant: `a${i}` });
    }
    expect(await list(alice)).toHaveLength(MAX_CONVERSATIONS);
    await saveTurn(db, uid, { user: "newest", assistant: "answer" });
    const after = await list(alice);
    expect(after).toHaveLength(MAX_CONVERSATIONS);
    expect(after[0]!.title).toBe("newest");
    expect(after.some((c) => c.title === "q0")).toBe(false);
  });

  it("stops saving into a full conversation and says so", async () => {
    const uid = await userId("hist-alice");
    const db = getDb();
    const first = (await saveTurn(db, uid, { user: "start", assistant: "a" }))!;
    for (let i = 1; i < MAX_CONVERSATION_MESSAGES / 2; i++) {
      await saveTurn(db, uid, { conversationId: first.id, user: `q${i}`, assistant: "a" });
    }
    const full = await saveTurn(db, uid, {
      conversationId: first.id,
      user: "one more",
      assistant: "a",
    });
    expect(full).toEqual({ id: first.id, saved: false });
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, first.id));
    expect(rows).toHaveLength(MAX_CONVERSATION_MESSAGES);
  });

  it("titles are one clipped line", async () => {
    const uid = await userId("hist-alice");
    await saveTurn(getDb(), uid, {
      user: `line one\n\nline   two ${"x".repeat(200)}`,
      assistant: "a",
    });
    const [c] = await list(alice);
    expect(c!.title.length).toBeLessThanOrEqual(80);
    expect(c!.title.startsWith("line one line two ")).toBe(true);
    expect(c!.title.endsWith("…")).toBe(true);
  });

  it("the retention sweep deletes only conversations past the retention period", async () => {
    const uid = await userId("hist-alice");
    const db = getDb();
    const old = (await saveTurn(db, uid, { user: "old", assistant: "a" }))!;
    await saveTurn(db, uid, { user: "recent", assistant: "a" });
    const stale = new Date(Date.now() - (RETENTION_DAYS + 1) * 86_400_000);
    await db
      .update(assistantConversations)
      .set({ updatedAt: stale })
      .where(eq(assistantConversations.id, old.id));
    expect(await purgeExpiredConversations(db)).toBe(1);
    expect((await list(alice)).map((c) => c.title)).toEqual(["recent"]);
    expect(await getDb().select().from(assistantMessages)).toHaveLength(2); // cascade removed old's
  });
});

describe("races", () => {
  it("does not store a turn that finishes after the user turned history off", async () => {
    await setHistory(alice, true);
    const uid = await userId("hist-alice");
    // The stream started with history on; the user opts out before the model finishes.
    await setHistory(alice, false);
    expect(await saveTurn(getDb(), uid, { user: "late", assistant: "answer" })).toBeNull();
    expect(await getDb().select().from(assistantConversations)).toHaveLength(0);
  });

  it("keeps both turns when two arrive at once for the same conversation", async () => {
    await setHistory(alice, true);
    const uid = await userId("hist-alice");
    const db = getDb();
    const first = (await saveTurn(db, uid, { user: "start", assistant: "a" }))!;
    const results = await Promise.all([
      saveTurn(db, uid, { conversationId: first.id, user: "tab one", assistant: "a1" }),
      saveTurn(db, uid, { conversationId: first.id, user: "tab two", assistant: "a2" }),
    ]);
    expect(results.every((r) => r?.saved)).toBe(true);
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, first.id));
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.seq)).size).toBe(6);
  });
});
