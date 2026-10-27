import type {
  InboxDocument,
  DocumentCategory,
  ImportRecord,
  ImportDetail,
  UnmappedEventType,
} from "@portfolio/api-client";
import { documentsForPortfolios } from "@/lib/inbox-documents";
import {
  getServerApi,
  getSelectedPortfolioId,
  listPortfoliosCached,
  resolveHolderScope,
} from "./_shared";

export async function loadDocuments(category?: DocumentCategory): Promise<InboxDocument[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    const portfolioId = await getSelectedPortfolioId();
    // Portfolio scope: the inbox endpoint filters itself.
    if (portfolioId) return await api.listDocuments(category, portfolioId);

    // Holder scope: GET /documents has no holder filter (each inbox row is attached to
    // one portfolio). Compose it the same way the other holder views do — the holder's
    // portfolios, then only their documents — so a holder page doesn't list every
    // portfolio's inbox (#1155). No holder scope (or a holder who doesn't qualify)
    // keeps the all-portfolios list.
    const portfolios = await listPortfoliosCached();
    const holderId = await resolveHolderScope(portfolios);
    const docs = await api.listDocuments(category);
    if (!holderId) return docs;
    const owned = new Set(
      portfolios.filter((p) => p.accountHolderId === holderId).map((p) => p.id),
    );
    return documentsForPortfolios(docs, owned);
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
