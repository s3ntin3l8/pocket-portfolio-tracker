import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { trConnections } from "@portfolio/db";
import {
  PytrApprovalError,
  PytrCodeInvalidError,
  PytrCodeRequiredError,
  PytrUnavailableError,
} from "../../services/pytr/runner.js";
import { sanitizeConnectionError } from "../../lib/sanitize-error.js";
import { getConnection, lookupPortfolio } from "./_shared.js";

const connectBodySchema = z.object({
  phone: z.string().min(3),
  pin: z.string().min(4),
  portfolioId: z.guid(),
  wafToken: z.string().min(1).optional(),
});

// Authenticator-app (TOTP) pairings send the 6-digit code here. The strict pattern also keeps
// anything but digits (newlines included) out of the login process's stdin.
const verifyBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).nullish();

type PairingStart =
  { method: "push" | "authenticator" } | { reply: { code: number; body: { error: string } } };

// Starts a pytr login and maps its failures to the route contract. Shared by the first
// pairing and by Renew so both answer identically.
async function beginPairing(
  app: FastifyInstance,
  request: FastifyRequest,
  userId: string,
  creds: { phone: string; pin: string; wafToken?: string },
): Promise<PairingStart> {
  try {
    const { method } = await app.pytr.startPairing(userId, creds);
    return { method };
  } catch (err) {
    if (err instanceof PytrUnavailableError) {
      return { reply: { code: 503, body: { error: "pytr_not_available" } } };
    }
    request.log.error({ err }, "tr pairing failed to start");
    return { reply: { code: 502, body: { error: "tr_pairing_failed" } } };
  }
}

export function registerPairingRoutes(app: FastifyInstance) {
  app.post("/tr/connection", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;
    if (!app.encryption.isEnabled) {
      return reply.code(503).send({ error: "encryption_required" });
    }
    const body = connectBodySchema.parse(request.body);
    const portfolio = await lookupPortfolio(app, id, body.portfolioId);
    if (!portfolio) {
      return reply.code(404).send({ error: "portfolio_not_found" });
    }
    if (portfolio.isChild) {
      return reply.code(422).send({ error: "tr_child_account_unsupported" });
    }

    request.log.info(
      {
        userId: id,
        portfolioId: body.portfolioId,
        wafStrategy: body.wafToken ? "token" : "default",
      },
      "tr pairing started",
    );
    const started = await beginPairing(app, request, id, {
      phone: body.phone,
      pin: body.pin,
      wafToken: body.wafToken,
    });
    if ("reply" in started) return reply.code(started.reply.code).send(started.reply.body);
    const { method } = started;

    await app.db
      .insert(trConnections)
      .values({
        userId: id,
        portfolioId: body.portfolioId,
        phoneEnc: app.encryption.encryptString(body.phone),
        pinEnc: app.encryption.encryptString(body.pin),
        status: "awaiting_2fa",
        lastError: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trConnections.userId,
        set: {
          portfolioId: body.portfolioId,
          phoneEnc: app.encryption.encryptString(body.phone),
          pinEnc: app.encryption.encryptString(body.pin),
          sessionEnc: null,
          status: "awaiting_2fa",
          lastError: null,
          updatedAt: new Date(),
        },
      });

    reply.code(202);
    return { status: "awaiting_2fa", method };
  });

  // One-tap renew: the stored (encrypted) phone + PIN start a fresh push login, so the user
  // only confirms in the Trade Republic app. Completion reuses POST /tr/connection/verify.
  // Only a connection that already needs attention (or is mid-pairing) can be renewed: a
  // working one keeps its session until a login actually replaces it.
  app.post("/tr/connection/renew", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;
    if (!app.encryption.isEnabled) {
      return reply.code(503).send({ error: "encryption_required" });
    }
    const conn = await getConnection(app, id);
    if (!conn || conn.status === "disconnected") {
      return reply.code(409).send({ error: "not_connected" });
    }
    if (conn.syncing) return reply.code(409).send({ error: "sync_in_progress" });
    if (conn.status === "connected") {
      return reply.code(409).send({ error: "already_connected" });
    }

    request.log.info({ userId: id }, "tr renew started");
    const started = await beginPairing(app, request, id, {
      phone: app.encryption.decryptString(conn.phoneEnc),
      pin: app.encryption.decryptString(conn.pinEnc),
    });
    if ("reply" in started) return reply.code(started.reply.code).send(started.reply.body);

    await app.db
      .update(trConnections)
      .set({ status: "awaiting_2fa", lastError: null, updatedAt: new Date() })
      .where(eq(trConnections.userId, id));

    reply.code(202);
    return { status: "awaiting_2fa", method: started.method };
  });

  // Abort an in-flight pairing WITHOUT forgetting the saved credentials (DELETE
  // /tr/connection wipes them). A connection that had a working session before goes back to
  // `expired` so the Renew prompt returns; one that never worked is left to be re-paired.
  app.post("/tr/connection/cancel", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;
    app.pytr.cancelPairing(id);
    const conn = await getConnection(app, id);
    if (conn && conn.status === "awaiting_2fa" && conn.sessionEnc) {
      await app.db
        .update(trConnections)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(trConnections.userId, id));
    }
    return reply.code(204).send();
  });

  app.post("/tr/connection/verify", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;

    const conn = await getConnection(app, id);
    if (!conn || conn.status !== "awaiting_2fa" || !app.pytr.hasPendingPairing(id)) {
      return reply.code(409).send({ error: "no_pairing_in_progress" });
    }

    // A malformed code is just a refused code: answer in the same contract as the others
    // instead of the global validation error.
    const parsed = verifyBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "code_invalid" });
    const { code } = parsed.data ?? {};
    request.log.info({ userId: id }, "tr approval awaiting");
    let sessionData: string;
    try {
      sessionData = await app.pytr.awaitApproval(id, code);
    } catch (err) {
      // A missing/refused authenticator code leaves the pairing alive for another try, so it
      // must not flip the connection to `error`.
      if (err instanceof PytrCodeRequiredError) {
        return reply.code(400).send({ error: "code_required" });
      }
      if (err instanceof PytrCodeInvalidError) {
        request.log.info("tr authenticator code refused");
        return reply.code(400).send({ error: "code_invalid" });
      }
      const error = sanitizeConnectionError(err, "approval failed");
      await app.db
        .update(trConnections)
        .set({ status: "error", lastError: error, updatedAt: new Date() })
        .where(eq(trConnections.userId, id));
      if (err instanceof PytrApprovalError) {
        request.log.info({ err }, "tr login not approved");
        return reply.code(400).send({ error: "not_approved" });
      }
      request.log.warn({ err }, "tr approval failed");
      return reply.code(502).send({ error: "tr_approval_failed" });
    }

    await app.db
      .update(trConnections)
      .set({
        sessionEnc: app.encryption.encryptString(sessionData),
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(trConnections.userId, id));

    request.log.info({ userId: id }, "tr connected");
    return { status: "connected" };
  });
}
