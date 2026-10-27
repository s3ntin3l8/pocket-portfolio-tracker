import type {
  InboxDocument,
  DocumentCategory,
  ImportRecord,
  ImportDetail,
  UnmappedEventType,
  Portfolio,
} from "@portfolio/api-client";
import { documentsForPortfolios, inboxPortfolios } from "@/lib/inbox-documents";
import {
  getServerApi,
  getSelectedPortfolioId,
  listPortfoliosCached,
  resolveEffectiveScope,
} from "./_shared";

/** Portfolios the inbox may list and upload into for the current scope (#1155). */
export async function resolveInboxScope(): Promise<{
  portfolios: Portfolio[];
  portfolioIds: string[] | null;
}> {
  try {
    const portfolios = await listPortfoliosCached();
    return inboxPortfolios(portfolios, await resolveEffectiveScope(portfolios));
  } catch {
    return { portfolios: [], portfolioIds: null };
  }
}

export async function loadDocuments(category?: DocumentCategory): Promise<InboxDocument[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    const portfolioId = await getSelectedPortfolioId();
    // Portfolio scope: the inbox endpoint filters itself.
    if (portfolioId) return await api.listDocuments(category, portfolioId);

    // Holder scope: GET /documents takes one portfolioId, not a holder. The portfolio
    // list and the inbox read don't depend on each other — fetch them together, then
    // keep only the holder's portfolios. No holder scope (or a holder who doesn't
    // qualify) keeps the all-portfolios list (#1155).
    const [portfolios, docs] = await Promise.all([
      listPortfoliosCached(),
      api.listDocuments(category),
    ]);
    const { portfolioIds } = inboxPortfolios(portfolios, await resolveEffectiveScope(portfolios));
    if (portfolioIds == null) return docs;
    return documentsForPortfolios(docs, new Set(portfolioIds));
  } catch {
    return [];
  }
}

export async function loadImports(): Promise<ImportRecord[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    return await api.listImports();
  } catch {
    return [];
  }
}

export async function loadUnmappedEventTypes(): Promise<UnmappedEventType[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    return await api.getUnmappedEventTypes();
  } catch {
    return [];
  }
}

export async function loadImport(importId: string): Promise<ImportDetail | null> {
  const api = await getServerApi();
  if (!api) return null;
  try {
    return await api.getImport(importId);
  } catch {
    return null;
  }
}
