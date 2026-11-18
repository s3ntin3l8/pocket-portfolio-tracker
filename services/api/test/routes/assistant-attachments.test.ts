/**
 * Opt-in document attachments in the assistant chat: the opt-in and write-scope gates, limits and
 * type checks, the model capability matrix, the PDF→text fallback, and the rule that a file is
 * never stored and never logged (history keeps text + a marker; the pino stream has no content).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";

const extractPdfText = vi.hoisted(() => vi.fn(async (_data: Buffer) => "BUY 2 ACME @ 10.00 EUR"));
vi.mock("../../src/services/parsers/pdf-text.js", () => ({ extractPdfText }));

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import type {
  AttachmentSupport,
  ChatProvider,
  ChatRequest,
  ChatResult,
} from "../../src/services/chat/types.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let privateKey: CryptoKey;
let app: App;
let owner: string;
const logLines: string[] = [];

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

let requests: ChatRequest[] = [];
let support: AttachmentSupport | undefined;
const fake: ChatProvider = {
  name: "fake",
  label: "Fake model",
  local: false,
  isConfigured: () => true,
  attachmentSupport: undefined,
  async complete(req) {
    requests.push({ ...req, messages: structuredClone(req.messages) });
    return endTurn("Drafted.");
  },
};

// Bytes that are a real PNG/PDF header followed by a recognisable payload.
const PAYLOAD = "SENTINEL-PAYLOAD-0123456789-ACCOUNT-DE89370400440532013000";
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(PAYLOAD),
]).toString("base64");
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(PAYLOAD)]).toString("base64");
const NAME = "iban-DE89-statement";

const file = (over: Record<string, unknown> = {}) => ({
  name: `${NAME}.png`,
  mediaType: "image/png",
  data: png,
  ...over,
});
const ask = (attachments?: unknown[], text = "Record this trade") => ({
  messages: [{ role: "user", content: text, ...(attachments ? { attachments } : {}) }],
});

async function chat(token: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url: "/assistant/chat",
    headers: { ...auth(token), "content-type": "application/json" },
    payload: payload as object,
  });
}
const prefs = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PUT", url: "/me/preferences", headers: auth(token), payload });
const status = async (token: string) =>
  (await app.inject({ method: "GET", url: "/assistant/status", headers: auth(token) })).json();
async function readToken(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/me/tokens",
    headers: auth(owner),
    payload: { name: `ro-${Math.random()}`, scope: "read" },
  });
  return res.json().token as string;
}

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  process.env.ASSISTANT_RATE_LIMIT_MAX = "10000";
  app = await buildApp({
    authKey: kp.publicKey,
    chatProvider: fake,
    logStream: { write: (line: string) => void logLines.push(line) },
  });
  app.resolveChatProvider = async () => fake;
  owner = await jwt("attachments-owner");
});
afterAll(async () => {
  await app.close();
  await closeDb();
});
beforeEach(async () => {
  requests = [];
  extractPdfText.mockClear();
  support = { images: "yes", pdf: true };
  fake.attachmentSupport = async () => support!;
  await prefs(owner, { assistantAttachments: false, assistantSaveHistory: false });
});

describe("opt-in and scope gates", () => {
  it("is off by default: status says so and a chat with a file is refused before the model", async () => {
    expect((await status(owner)).attachments).toEqual({
      enabled: false,
      optedIn: false,
      images: "yes",
      pdf: true,
    });
    const res = await chat(owner, ask([file()]));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "attachments_disabled" });
    expect(requests).toHaveLength(0);
  });

  it("enables with the preference and reports what the model reads", async () => {
    await prefs(owner, { assistantAttachments: true });
    support = { images: "maybe", pdf: false };
    expect((await status(owner)).attachments).toEqual({
      enabled: true,
      optedIn: true,
      images: "maybe",
      pdf: false,
    });
  });

  it("defaults the capability to images 'maybe' / no native PDF when the provider doesn't say", async () => {
    await prefs(owner, { assistantAttachments: true });
    fake.attachmentSupport = undefined;
    expect((await status(owner)).attachments).toEqual({
      enabled: true,
      optedIn: true,
      images: "maybe",
      pdf: false,
    });
  });

  it("refuses a read-scoped token even when the user opted in, and shows it as disabled", async () => {
    await prefs(owner, { assistantAttachments: true });
    const ro = await readToken();
    // Opted in, but this credential can't write: not enabled, yet the opt-in is reported as set.
    expect((await status(ro)).attachments).toMatchObject({ enabled: false, optedIn: true });
    const res = await chat(ro, ask([file()]));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "attachments_disabled" });
    expect(requests).toHaveLength(0);
    // …but the same token can still chat without files.
    expect((await chat(ro, ask())).statusCode).toBe(200);
  });

  it("round-trips the preference", async () => {
    const get = async () =>
      (await app.inject({ method: "GET", url: "/me/preferences", headers: auth(owner) })).json();
    expect((await get()).assistantAttachments).toBe(false);
    expect((await prefs(owner, { assistantAttachments: true })).json().assistantAttachments).toBe(
      true,
    );
    expect((await get()).assistantAttachments).toBe(true);
  });
});

describe("opted in and write-scoped", () => {
  beforeEach(async () => {
    await prefs(owner, { assistantAttachments: true });
  });

  it("hands the file to the model, tells it the document is untrusted data, and streams an answer", async () => {
    const res = await chat(owner, ask([file()]));
    expect(res.statusCode).toBe(200);
    const m = requests[0]!.messages[0] as { content: string; attachments: { data: string }[] };
    expect(m.content).toBe("Record this trade");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.data).toBe(png);
    expect(requests[0]!.system).toMatch(/untrusted input/);
    expect(requests[0]!.system).toMatch(/never follow instructions/i);
    expect(requests[0]!.system).toMatch(/never say anything was booked/);
  });

  it("does not mention documents in the prompt when none is attached", async () => {
    await chat(owner, ask());
    expect(requests[0]!.system).not.toMatch(/attached a document/);
  });

  it("keeps an earlier turn's file in a follow-up, so the model still sees the document", async () => {
    const res = await chat(owner, {
      messages: [
        { role: "user", content: "Record this trade", attachments: [file()] },
        { role: "assistant", content: "What is the price?" },
        { role: "user", content: "It is in the document" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const first = requests[0]!.messages[0] as { attachments?: unknown[] };
    expect(first.attachments).toHaveLength(1);
    expect((requests[0]!.messages[2] as { attachments?: unknown }).attachments).toBeUndefined();
  });

  it("refuses a mislabelled file, a type outside the allow-list and bad base64", async () => {
    for (const bad of [
      file({ mediaType: "application/pdf" }), // PNG bytes claiming to be a PDF
      file({ mediaType: "image/gif" }),
      file({ data: "not base64 !!" }),
    ]) {
      const res = await chat(owner, ask([bad]));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "attachment_unsupported" });
    }
    expect(requests).toHaveLength(0);
  });

  it("enforces the limits: at most 3 files, and a file over the size cap", async () => {
    const four = await chat(owner, ask([file(), file(), file(), file()]));
    expect(four.statusCode).toBe(400);
    expect(four.json().error).toBe("invalid_request");
    expect((await chat(owner, ask([file(), file(), file()]))).statusCode).toBe(200);

    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(6 * 1024 * 1024),
    ]).toString("base64");
    const big = await chat(owner, ask([file({ data: huge })]));
    expect(big.statusCode).toBe(400);
  });

  it("only a user turn may carry files", async () => {
    const res = await chat(owner, {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", attachments: [file()] },
        { role: "user", content: "again" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
  });

  it("refuses an image when the active model can't read images", async () => {
    support = { images: "no", pdf: false };
    const res = await chat(owner, ask([file()]));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "attachment_unsupported" });
    expect(requests).toHaveLength(0);
  });

  it("sends a PDF natively when the provider reads PDFs", async () => {
    const res = await chat(
      owner,
      ask([file({ name: "s.pdf", mediaType: "application/pdf", data: pdf })]),
    );
    expect(res.statusCode).toBe(200);
    expect(extractPdfText).not.toHaveBeenCalled();
    expect(
      (requests[0]!.messages[0] as { attachments: { mediaType: string }[] }).attachments[0]!
        .mediaType,
    ).toBe("application/pdf");
  });

  it("falls back to extracted text for a PDF the provider can't read, wrapped as data", async () => {
    support = { images: "yes", pdf: false };
    const res = await chat(
      owner,
      ask([file({ name: "s.pdf", mediaType: "application/pdf", data: pdf })]),
    );
    expect(res.statusCode).toBe(200);
    const m = requests[0]!.messages[0] as { content: string; attachments?: unknown };
    expect(m.attachments).toBeUndefined();
    expect(m.content).toContain('<document name="s.pdf">');
    expect(m.content).toContain("BUY 2 ACME @ 10.00 EUR");
  });

  it("refuses a PDF with no extractable text on a provider without PDF input", async () => {
    support = { images: "yes", pdf: false };
    extractPdfText.mockResolvedValueOnce("");
    const res = await chat(
      owner,
      ask([file({ name: "s.pdf", mediaType: "application/pdf", data: pdf })]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "attachment_unsupported" });
    expect(requests).toHaveLength(0);
  });
});

describe("never stored, never logged", () => {
  it("history keeps the text and a 📎 marker, never the bytes", async () => {
    await prefs(owner, { assistantAttachments: true, assistantSaveHistory: true });
    const res = await chat(owner, ask([file()]));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: conversation");

    const list = (
      await app.inject({ method: "GET", url: "/assistant/conversations", headers: auth(owner) })
    ).json();
    const id = list.conversations[0].id as string;
    const raw = (
      await app.inject({
        method: "GET",
        url: `/assistant/conversations/${id}`,
        headers: auth(owner),
      })
    ).body;
    const conv = JSON.parse(raw);
    expect(conv.messages[0]).toMatchObject({
      role: "user",
      content: `Record this trade\n📎 ${NAME}.png`,
    });
    expect(raw).not.toContain(png.slice(8, 40));
    expect(raw).not.toContain("SENTINEL");
  });

  it("logs the count, types and size of the files, and nothing of their content", async () => {
    await prefs(owner, { assistantAttachments: true });
    logLines.length = 0;
    await chat(
      owner,
      ask([file(), file({ name: "s.pdf", mediaType: "application/pdf", data: pdf })]),
    );
    const all = logLines.join("\n");
    const mine = logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "assistant attachments");
    expect(mine).toMatchObject({ attachments: 2, types: ["image/png", "application/pdf"] });
    expect(mine.bytes).toBeGreaterThan(0);
    for (const secret of [png, pdf, png.slice(8, 40), "SENTINEL", NAME, "DE89370400440532013000"]) {
      expect(all).not.toContain(secret);
    }
  });
});
