import type { FastifyInstance } from "fastify";
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
    let method: "push" | "authenticator";
    try {
      ({ method } = await app.pytr.startPairing(id, {
        phone: body.phone,
        pin: body.pin,
        wafToken: body.wafToken,
      }));
    } catch (err) {
      if (err instanceof PytrUnavailableError) {
        return reply.code(503).send({ error: "pytr_not_available" });
      }
      request.log.error({ err }, "tr pairing failed to start");
      return reply.code(502).send({ error: "tr_pairing_failed" });
    }

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
