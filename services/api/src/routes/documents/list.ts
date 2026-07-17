import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { documents, portfolios } from "@portfolio/db";
import { documentListQuerySchema } from "@portfolio/schema";
import { withDerivationCache, createStore } from "../../lib/derivation-cache.js";
import { listInboxDocuments } from "../../storage/inbox.js";
import { parsePagination, cacheKey } from "../helpers.js";

const documentsCache = createStore<{ rows: unknown[]; total: number }>();

function renderRow(
  d: {
    id: string;
    category: string | null;
    taxYear: number | null;
    source: string | null;
    originalFilename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    portfolioId: string | null;
    storedAt: Date;
  },
  nameById: Map<string, string>,
) {
  return {
    id: d.id,
    category: d.category,
    taxYear: d.taxYear,
    source: d.source,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    portfolioId: d.portfolioId,
    portfolioLabel: d.portfolioId ? (nameById.get(d.portfolioId) ?? null) : null,
    storedAt: d.storedAt,
  };
}

export async function handleListDocuments(
  app: FastifyInstance,
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  const id = request.userId;
  const {
    category,
    portfolioId,
    page: rawPage,
    pageSize: rawPageSize,
  } = documentListQuerySchema.parse(request.query);
  const { page, pageSize } = parsePagination({ page: rawPage, pageSize: rawPageSize });
  const hasPagination = pageSize > 0;

  request.timingName = "GET /documents";

  if (hasPagination) {
    const conditions = [eq(documents.userId, id), eq(documents.category, category ?? "tax_report")];
    if (portfolioId) conditions.push(eq(documents.portfolioId, portfolioId));

    const ck = cacheKey(id, page, pageSize, category ?? "", portfolioId ?? "");
    const cached = await withDerivationCache(documentsCache, ck, async () => {
      const [cnt, rows] = await Promise.all([
        app.db
          .select({ count: count() })
          .from(documents)
          .where(and(...conditions))
          .then((r) => Number(r[0].count)),
        app.db
          .select()
          .from(documents)
          .where(and(...conditions))
          .orderBy(desc(documents.storedAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);

      const portfolioIds = [
        ...new Set(rows.map((d) => d.portfolioId).filter((x): x is string => Boolean(x))),
      ];
      const portfolioRows = portfolioIds.length
        ? await app.db
            .select({ id: portfolios.id, name: portfolios.name })
            .from(portfolios)
            .where(inArray(portfolios.id, portfolioIds))
        : [];
      const nameById = new Map(portfolioRows.map((p) => [p.id, p.name]));

      return { rows: rows.map((d) => renderRow(d, nameById)), total: cnt };
    });

    request.timingMeta = { total: cached.total, page, pageSize };

    return cached;
  }

  const docs = await listInboxDocuments(app, { userId: id, category, portfolioId });

  const portfolioIds = [
    ...new Set(docs.map((d) => d.portfolioId).filter((x): x is string => Boolean(x))),
  ];
  const portfolioRows = portfolioIds.length
    ? await app.db
        .select({ id: portfolios.id, name: portfolios.name })
        .from(portfolios)
        .where(inArray(portfolios.id, portfolioIds))
    : [];
  const nameById = new Map(portfolioRows.map((p) => [p.id, p.name]));

  request.timingMeta = { docCount: docs.length };

  return docs.map((d) => renderRow(d, nameById));
}
