import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { decimalString } from "@portfolio/schema";
import {
  LoanActionError,
  payoffLoan,
  reopenLoan,
  skipInstallment,
  unskipInstallment,
} from "../services/loan-actions.js";

type LoanParams = { portfolioId: string; loanId: string };

const payoffBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  fees: decimalString.optional(),
});

const installmentParam = z.coerce.number().int().positive();

/**
 * Departing from a financed contract's schedule (cicilan): skip an installment, or pay the
 * loan off early. The daily booking job honours both (see `bookDueInstallments`).
 */
export async function loansRoute(app: FastifyInstance) {
  const pre = { preHandler: [app.authenticate, app.requirePortfolio] };

  // The action errors are the caller's input (unknown loan, already closed, bad date); map
  // them to their status instead of a 500.
  const guard =
    <T>(fn: (request: T) => Promise<unknown>) =>
    async (request: T, reply: FastifyReply) => {
      try {
        const body = await fn(request);
        return body === undefined ? reply.code(204).send() : body;
      } catch (err) {
        if (err instanceof LoanActionError) return reply.code(err.status).send({ error: err.code });
        throw err;
      }
    };

  app.post<{ Params: LoanParams & { n: string } }>(
    "/portfolios/:portfolioId/loans/:loanId/installments/:n/skip",
    pre,
    guard(async (request) => {
      const { portfolioId, loanId, n } = request.params;
      await skipInstallment(app.db, portfolioId, loanId, installmentParam.parse(n));
    }),
  );

  app.delete<{ Params: LoanParams & { n: string } }>(
    "/portfolios/:portfolioId/loans/:loanId/installments/:n/skip",
    pre,
    guard(async (request) => {
      const { portfolioId, loanId, n } = request.params;
      await unskipInstallment(app.db, portfolioId, loanId, installmentParam.parse(n));
    }),
  );

  app.post<{ Params: LoanParams; Body: unknown }>(
    "/portfolios/:portfolioId/loans/:loanId/payoff",
    pre,
    guard(async (request) => {
      const { portfolioId, loanId } = request.params;
      return payoffLoan(app.db, portfolioId, loanId, payoffBodySchema.parse(request.body));
    }),
  );

  app.delete<{ Params: LoanParams }>(
    "/portfolios/:portfolioId/loans/:loanId/payoff",
    pre,
    guard(async (request) => {
      const { portfolioId, loanId } = request.params;
      await reopenLoan(app.db, portfolioId, loanId);
    }),
  );
}
