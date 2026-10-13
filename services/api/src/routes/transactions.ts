import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getFxRatesForDates } from "../services/fx.js";
import { isReadOnlyPat } from "../plugins/auth.js";
import { registerListRoutes } from "./transactions/list.js";
import { registerCrudRoutes } from "./transactions/crud.js";
import { registerHoldingsRoutes } from "./transactions/holdings.js";
import { registerTradesRoutes } from "./transactions/trades.js";
import { registerIncomeRoutes } from "./transactions/income.js";
import { registerGoldRoutes } from "./transactions/gold.js";
import { registerTaxRoutes } from "./transactions/tax.js";
import { registerContributionsRoutes } from "./transactions/contributions.js";
import { registerSparplanRoutes } from "./transactions/sparplan.js";
import { registerHistoryRoutes } from "./transactions/history.js";
import { registerNetworthRoutes } from "./transactions/networth.js";
import { registerInsightsRoutes } from "./transactions/insights.js";

export async function transactionsRoute(app: FastifyInstance) {
  registerListRoutes(app);
  registerCrudRoutes(app);
  registerHoldingsRoutes(app);
  registerTradesRoutes(app);
  registerIncomeRoutes(app);
  registerGoldRoutes(app);
  registerTaxRoutes(app);
  registerContributionsRoutes(app);
  registerSparplanRoutes(app);
  registerHistoryRoutes(app);
  registerNetworthRoutes(app);
  registerInsightsRoutes(app);

  const fxRateQuerySchema = z.object({
    from: z.string().regex(/^[A-Z]{3}$/),
    to: z.string().regex(/^[A-Z]{3}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  // GET /fx-rate — lightweight FX lookup for the transaction detail sheet.
  app.get("/fx-rate", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = fxRateQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "from, to, and date are required" });
    }
    const { from, to, date } = parsed.data;
    // Read-scoped PAT: serve from the fx_rates cache only (no provider call, no insert).
    const rates = await getFxRatesForDates(
      app.db,
      [from],
      to,
      [date],
      isReadOnlyPat(request) ? null : undefined,
    );
    const rate = rates.get(date)?.[from] ?? null;
    return { rate };
  });
}
