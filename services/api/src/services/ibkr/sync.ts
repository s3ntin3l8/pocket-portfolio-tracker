import { and, desc, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { FastifyBaseLogger } from "fastify";
import {
  ibkrConnections,
  screenshotImports,
  transactions,
  trResolvedEvents,
} from "@portfolio/db";
import type { ImportIssue, ParsedTransaction } from "@portfolio/schema";
import type { DB } from "../../db/client.js";
import type { EncryptionService } from "../encryption.js";
import type { IbkrFlexClient } from "./flex-client.js";
import { IbkrFlexError } from "./flex-client.js";
import { parseFlexXml } from "./flex-parse.js";
import { mapFlexToDrafts } from "./mapper.js";
import type { CashReconciliation } from "../pytr/sync.js";

export type { CashReconciliation };

type IbkrConnectionRow = typeof ibkrConnections.$inferSelect;

export interface IbkrSyncResult {
  status: "connected" | "expired" | "error";
  importId?: string;
  drafts?: number;
  errors?: number;
  reconciliation?: CashReconciliation;
}

interface CollectorJson {
  drafts: ParsedTransaction[];
  errors: ImportIssue[];
}

/** Derive cash balances from Flex CashReport for reconciliation. */
function reconcileCash(
  drafts: ParsedTransaction[],
  cashReport: { currency: string; endingCash: string }[],
): CashReconciliation | undefined {
  if (cashReport.length === 0) return undefined;

  const derived = new Map<string, Decimal>();
  for (const d of drafts) {
    const action = d.action as string;
    const amt = new Decimal(d.price ?? "0");
    const prev = derived.get(d.currency) ?? new Decimal(0);
    if (action === "deposit" || action === "interest" || action === "dividend") {
      derived.set(d.currency, prev.add(amt));
    } else if (action === "withdrawal") {
      derived.set(d.currency, prev.sub(amt));
    } else if (action === "buy" || action === "savings_plan") {
      const total = amt.mul(new Decimal(d.quantity ?? "0")).add(new Decimal(d.fees ?? "0"));
      derived.set(d.currency, prev.sub(total));
    } else if (action === "sell") {
      const total = amt.mul(new Decimal(d.quantity ?? "0")).sub(new Decimal(d.fees ?? "0"));
      derived.set(d.currency, prev.add(total));
    }
  }

  const cash = cashReport.map(({ currency, endingCash }) => {
    const derivedStr = (derived.get(currency) ?? new Decimal(0)).toFixed(2);
    return {
      currency,
      reported: endingCash,
      derived: derivedStr,
      diff: new Decimal(endingCash).sub(new Decimal(derivedStr)).toFixed(2),
    };
  });
  return { checkedAt: new Date().toISOString(), cash };
}

/**
 * Sync one IBKR connection: decrypt token, fetch Flex statement, parse into drafts,
 * diff against the resolved-events ledger and the open collector draft.
 *
 * Structured like pytr/sync.ts but without the Python runner or 2FA complexity.
 * All IBKR events use source='ibkr' in the ledger so they can't collide with pytr IDs.
 */
export async function syncIbkrConnection(
  db: DB,
  encryption: EncryptionService,
  flexClient: IbkrFlexClient,
  connection: IbkrConnectionRow,
  log?: FastifyBaseLogger,
): Promise<IbkrSyncResult> {
  if (!connection.portfolioId) {
    log?.warn({ connectionId: connection.id }, "ibkr sync skipped: no portfolio linked");
    return { status: "error" };
  }

  const token = encryption.decryptString(connection.tokenEnc);
  const { queryId, portfolioId } = connection;
  const connectionId = connection.id;

  let xml: string;
  try {
    log?.debug({ connectionId }, "ibkr flex fetch starting");
    xml = await flexClient.fetchFlexStatement(token, queryId);
  } catch (err) {
    const status = err instanceof IbkrFlexError && err.code === "expired" ? "expired" : "error";
    const lastError = err instanceof Error ? err.message : "sync failed";
    log?.warn({ connectionId, status, lastError }, "ibkr connection flipped");
    await db
      .update(ibkrConnections)
      .set({ status, lastError, syncing: false, updatedAt: new Date() })
      .where(eq(ibkrConnections.id, connectionId));
    return { status };
  }

  // Parse statements — a Flex export can contain multiple accounts; take all.
  const statements = parseFlexXml(xml);
  const allDrafts: ParsedTransaction[] = [];
  const allErrors: ImportIssue[] = [];
  for (const stmt of statements) {
    const { drafts, errors } = mapFlexToDrafts(stmt);
    allDrafts.push(...drafts);
    allErrors.push(
      ...errors.map((e) => ({
        message: e.message,
        severity: "attention" as const,
        line: e.line ?? 0,
      })),
    );
  }

  // Update the connection's flexAccountId from the first statement.
  const newAccountId = statements[0]?.accountId ?? null;

  // 1. Load the resolved ledger for this portfolio + source='ibkr'.
  const resolvedRows = await db
    .select({ eventId: trResolvedEvents.eventId })
    .from(trResolvedEvents)
    .where(
      and(
        eq(trResolvedEvents.portfolioId, portfolioId),
        eq(trResolvedEvents.source, "ibkr"),
      ),
    );
  const resolved = new Set(resolvedRows.map((r) => r.eventId));

  // Seed the ledger from any pre-existing confirmed ibkr transactions (idempotent).
  const confirmedRows = await db
    .select({ ext: transactions.externalId })
    .from(transactions)
    .where(and(eq(transactions.portfolioId, portfolioId), eq(transactions.source, "ibkr")));
  const confirmedIds = confirmedRows
    .map((r) => r.ext)
    .filter((x): x is string => Boolean(x));
  if (confirmedIds.length) {
    await db
      .insert(trResolvedEvents)
      .values(confirmedIds.map((eventId) => ({ portfolioId, source: "ibkr", eventId, resolution: "confirmed" })))
      .onConflictDoNothing();
    for (const id of confirmedIds) resolved.add(id);
  }

  // 2. Find the open collector draft (parser='ibkr').
  const [collector] = await db
    .select()
    .from(screenshotImports)
    .where(
      and(
        eq(screenshotImports.userId, connection.userId),
        eq(screenshotImports.portfolioId, portfolioId),
        eq(screenshotImports.parser, "ibkr"),
        eq(screenshotImports.status, "draft"),
      ),
    )
    .orderBy(desc(screenshotImports.createdAt))
    .limit(1);
  const existing = collector ? (collector.parsedJson as CollectorJson) : null;
  const stagedIds = new Set<string>(
    (existing?.drafts ?? []).map((d) => d.externalId).filter((x): x is string => Boolean(x)),
  );

  // 3. New = not resolved, not staged.
  const newDrafts = allDrafts.filter((d) => {
    const id = d.externalId;
    if (!id) return true; // always include drafts without stable IDs
    return !resolved.has(id) && !stagedIds.has(id);
  });
  const newErrors = allErrors;

  log?.debug(
    { connectionId, total: allDrafts.length, new: newDrafts.length, errors: newErrors.length },
    "ibkr events mapped",
  );

  // 4. Keep already-staged drafts that haven't been resolved.
  const keptDrafts = (existing?.drafts ?? []).filter(
    (d) => !d.externalId || !resolved.has(d.externalId),
  );
  const mergedDrafts = [...keptDrafts, ...newDrafts];
  const mergedErrors = newErrors;
  const parsedJson: CollectorJson = { drafts: mergedDrafts, errors: mergedErrors };

  // 5. Persist collector.
  let importId: string | undefined = collector?.id;
  const hasContent = mergedDrafts.length > 0 || mergedErrors.length > 0;
  let collectorAction: "updated" | "created" | "discarded" | "unchanged" = "unchanged";
  if (collector) {
    if (!hasContent) {
      await db
        .update(screenshotImports)
        .set({ status: "discarded" })
        .where(eq(screenshotImports.id, collector.id));
      importId = undefined;
      collectorAction = "discarded";
    } else {
      await db
        .update(screenshotImports)
        .set({ parsedJson })
        .where(eq(screenshotImports.id, collector.id));
      collectorAction = "updated";
    }
  } else if (hasContent) {
    const [imp] = await db
      .insert(screenshotImports)
      .values({ userId: connection.userId, portfolioId, parser: "ibkr", parsedJson, status: "draft" })
      .returning();
    importId = imp.id;
    collectorAction = "created";
  }
  log?.info(
    { connectionId, importId, action: collectorAction, drafts: mergedDrafts.length, errors: mergedErrors.length },
    "ibkr collector updated",
  );

  // 6. Cash reconciliation from Flex CashReport.
  const cashReport =
    statements[0]?.cashReport.map((c) => ({ currency: c.currency ?? "USD", endingCash: c.endingCash ?? "0" })) ?? [];
  const reconciliation = reconcileCash(allDrafts, cashReport);

  // 7. Update connection.
  await db
    .update(ibkrConnections)
    .set({
      status: "connected",
      lastSyncAt: new Date(),
      lastError: null,
      syncing: false,
      updatedAt: new Date(),
      ...(newAccountId ? { flexAccountId: newAccountId } : {}),
      ...(reconciliation ? { lastReconciliation: reconciliation } : {}),
    })
    .where(eq(ibkrConnections.id, connectionId));

  log?.info({ connectionId, reconciled: !!reconciliation }, "ibkr connection synced");

  return {
    status: "connected",
    importId,
    drafts: newDrafts.length,
    errors: newErrors.length,
    reconciliation,
  };
}
