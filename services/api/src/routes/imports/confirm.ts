import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { portfolios, screenshotImports, trResolvedEvents } from "@portfolio/db";
import {
  parsedGoldContractSchema,
  parsedTransactionSchema,
  transferNeedsCostBasis,
} from "@portfolio/schema";
import { accountMismatchVerdict } from "./helpers.js";
import { ownedPortfolio } from "../helpers.js";
import { enrichTransactionFromDrafts } from "../../services/enrichment.js";
import {
  resolveDraftInstruments,
  classifyDraftDuplicates,
  writeResolvedDrafts,
  decideDuplicates,
  type CommittedCandidate,
  type TxRow,
} from "../../services/materialize-drafts.js";
import { writeGoldContracts } from "./gold-contracts.js";
import { finalizeConfirmedImport } from "./finalize.js";
import { bumpImportListVersion } from "../../lib/derivation-cache.js";

const confirmBodySchema = z.object({
  // Target portfolio — required when the import was uploaded without one (upload-first
  // flow). Falls back to `imp.portfolioId` for pytr and legacy uploads that stored one.
  portfolioId: z.string().uuid().optional(),
  // At least one of `transactions` / `contracts` must be present.
  transactions: z.array(parsedTransactionSchema).default([]),
  // Financed gold-purchase contracts (Pegadaian/Galeri24 cicilan). Each becomes a
  // loan row plus its derived legs.
  contracts: z.array(parsedGoldContractSchema).default([]),
  // Set true to proceed past an account-number mismatch (the file looks like it belongs
  // to a different portfolio). The server otherwise refuses with 409 (#197).
  acknowledgeAccountMismatch: z.boolean().default(false),
  // Set true to proceed past cross-source economic duplicates (the same trade was already
  // imported from another format). The server otherwise refuses with 409 (#217).
  acknowledgeDuplicates: z.boolean().default(false),
  // Per-draft disposition for the duplicates the server reported. Each entry names the
  // draft by its index in the submitted `transactions` array and says what to do with it:
  //   • "skip"   — don't write it and don't enrich anything with it (the trade is already
  //                in the portfolio; this import just repeats it)
  //   • "import" — write it as its own transaction even though it duplicates an existing one
  //   • "enrich" — fold it into the matched transaction (link the document, merge tax/fees)
  // An entry wins over `acknowledgeDuplicates` for that draft. Drafts without an entry fall
  // back to the blanket behaviour.
  resolutions: z
    .array(
      z.object({
        draftIndex: z.number().int().nonnegative(),
        action: z.enum(["skip", "import", "enrich"]),
      }),
    )
    .default([]),
});

/** Registers POST /imports/:importId/confirm — write the (possibly edited) drafts as
 *  transactions. Extracted from imports.ts (the ~730-line two-pass confirm transaction). */
export function registerConfirmImportRoute(app: FastifyInstance) {
  app.post<{ Params: { importId: string } }>(
    "/imports/:importId/confirm",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const [imp] = await app.db
        .select()
        .from(screenshotImports)
        .where(
          and(eq(screenshotImports.id, request.params.importId), eq(screenshotImports.userId, id)),
        )
        .limit(1);
      if (!imp) {
        return reply.code(404).send({ error: "import_not_found" });
      }
      if (imp.status === "confirmed") {
        return reply.code(409).send({ error: "already_confirmed" });
      }

      const confirmBody = confirmBodySchema.parse(request.body);
      const {
        contracts,
        portfolioId: bodyPortfolioId,
        acknowledgeAccountMismatch,
        acknowledgeDuplicates,
        resolutions,
      } = confirmBody;
      const drafts = confirmBody.transactions;
      if (drafts.length === 0 && contracts.length === 0) {
        return reply.code(400).send({ error: "nothing_to_confirm" });
      }
      // An inbound depot transfer at price 0 would land the shares at zero cost basis (a
      // later sale then reports 100% gain and fully taxable proceeds). Refuse until the
      // user enters the carried cost in the review screen (audit B4). `draftIndices` are
      // positions in the submitted `transactions` array.
      const missingCostBasis = drafts.flatMap((d, i) => (transferNeedsCostBasis(d) ? [i] : []));
      if (missingCostBasis.length > 0) {
        return reply
          .code(400)
          .send({ error: "transfer_cost_basis_required", draftIndices: missingCostBasis });
      }
      // Resolve the target portfolio: prefer the request body, fall back to what was
      // stored on the import (pytr always has one; legacy uploads may too). New-style
      // uploads have no stored portfolio so body is required.
      const targetPortfolioId = bodyPortfolioId ?? imp.portfolioId;
      if (!targetPortfolioId) {
        return reply.code(400).send({ error: "portfolio_required" });
      }
      const targetPortfolio = await ownedPortfolio(app, id, targetPortfolioId);
      if (!targetPortfolio) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }

      // Account-mismatch guard (#197, defense-in-depth): if the file's account number looks
      // like it belongs to a different portfolio than the chosen one, refuse until the
      // caller explicitly acknowledges. The web flow surfaces this as a banner + "Import
      // anyway". pytr is exempt — it's always bound to its connection's portfolio.
      const importedAccountNumber = (imp.parsedJson as { accountNumber?: string | null } | null)
        ?.accountNumber;
      if (!acknowledgeAccountMismatch && imp.parser !== "pytr") {
        const mismatch = await accountMismatchVerdict(
          app,
          id,
          importedAccountNumber,
          targetPortfolioId,
        );
        if (mismatch) {
          request.log.info(
            { importId: imp.id, kind: mismatch.kind },
            "confirm blocked: account mismatch",
          );
          return reply.code(409).send({ error: "account_mismatch", ...mismatch });
        }
      }
      const isDkb = imp.parser === "dkb";
      const isPytr = imp.parser === "pytr";
      // The Trade Republic CSV export is an offline ingestion of the same TR account: it
      // resolves ISINs like the pytr path, but is a connectionless one-shot import, so it
      // stays `source="csv"` (not the pytr collector / resolved-events branch).
      const isTrCsv = imp.parser === "tr-csv";
      // Deterministic PDF parsers tag the import with "dkb-pdf" / "tr-pdf" at upload time
      // so we can route them to source="pdf" and preserve EU/ISIN instrument resolution.
      const isDkbPdf = imp.parser === "dkb-pdf";
      const isTrPdf = imp.parser === "tr-pdf";
      // IBKR Activity Flex XML: its own source tag so dedup, enrichment, and the rank
      // rollup treat it correctly. ISIN resolution uses the same EU/OpenFIGI path since
      // IBKR carries ISINs in the Flex data (global, not EU-only, but the code path works).
      const isIbkr = imp.parser === "ibkr";
      // pytr is its own source; DKB/TR PDFs get the new "pdf" source; IBKR gets "ibkr";
      // DKB-CSV and TR-CSV exports are CSV; everything else (LLM vision) is screenshot.
      const source =
        imp.parser === "ai"
          ? "manual" // AI-assisted entry: user-confirmed typed data, no document (see parserToTxSource)
          : isPytr
            ? "pytr"
            : isIbkr
              ? "ibkr"
              : isDkbPdf || isTrPdf
                ? "pdf"
                : imp.parser === "csv" || isDkb || isTrCsv
                  ? "csv"
                  : "screenshot";
      // DKB, Trade Republic, and IBKR all carry ISINs in their exports — use the
      // OpenFIGI ISIN-resolution path for all of them.
      const isEu = isDkb || isPytr || isTrCsv || isDkbPdf || isTrPdf || isIbkr;

      // Cash transactions are always imported. The portfolio's `cashCounted` boundary
      // decides whether they are *counted* (net worth, cash, contributions) and whether
      // they are *shown* in the transaction list — both of which are read-time decisions
      // over the stored rows, not a write-time filter. Dropping them here would lose the
      // data the user needs when they switch the portfolio to cash-inside, and would
      // understate the Indonesian deposit-interest base, which is derived from the cash
      // rows and deliberately ignores the boundary (packages/core/src/tax-id.ts).

      request.log.info(
        {
          importId: imp.id,
          parser: imp.parser,
          source,
          txDrafts: drafts.length,
          contracts: contracts.length,
        },
        "confirm started",
      );

      // Pass 1 — resolve each draft's instrument (best-effort, may hit the network). Done
      // OUTSIDE the transaction so a slow OpenFIGI/provider lookup never holds a DB tx open.
      // AI-assisted entry mixes instrument kinds: ISIN-bearing drafts take the EU/OpenFIGI path.
      const resolved = await resolveDraftInstruments(app, drafts, {
        isEu,
        euWhenIsin: imp.parser === "ai",
        portfolioId: targetPortfolioId,
      });

      // Cross-source duplicate check (#196, hardened to a real backstop in #217, enrichment
      // classification added in #259): now that instruments are resolved, find drafts that
      // economically match a transaction already committed to the target portfolio. Matches
      // are classified into:
      //   • "enrichment" — different source + import carries a document or taxComponents.
      //     Auto-applied in pass 2 (links PDF, folds in tax/fees) with no blocking 409.
      //   • "duplicate" — same source or no new value. Blocks with a 409 unless acknowledged.
      //
      // Invariant: confirm owns routing. The advisory upload-time badges are best-effort
      // (keyed on ISIN/WKN rather than resolved instrumentId); this pass re-classifies
      // independently and is authoritative. The classifier itself lives in
      // services/materialize-drafts.ts so the sync path reuses it.
      //
      // KNOWN RACE (B11): the cross-source dedup check used to run *outside* the
      // write transaction below. Two concurrent confirms of overlapping sources
      // could both pass the 409 gate (both seeing no committed match yet) and
      // both write the same economic trade. The fallback was the same-source
      // (portfolioId, source, externalId) unique index, which only catches
      // identical externalIds — cross-source duplicates (e.g. CSV vs PDF) still
      // slipped through.
      //
      // Fix: do the row-locked SELECT … FOR UPDATE and the classification inside
      // the write transaction. The lock serialises concurrent confirms of the
      // same portfolio; the second one waits, then sees the first's committed
      // matches and returns 409 unless the caller already acknowledged.

      // Pass 2 — write the transactions and reconcile the import atomically.
      const parsed = (imp.parsedJson ?? {}) as {
        drafts?: { externalId?: string | null }[];
        errors?: { eventId?: string; severity?: string }[];
        seenEventIds?: string[];
      };
      let attempted = 0;
      let skipped = 0;
      let finalStatus: "draft" | "confirmed" = "draft";
      type TxResult =
        | {
            kind: "ok";
            written: TxRow[];
            enrichmentMatches: Array<{ draftIndex: number; matchedTransactionId: string }>;
            skippedDuplicates: number;
            pendingDuplicates: number;
          }
        | {
            kind: "duplicate";
            plainDuplicates: Array<{ draftIndex: number; matched: CommittedCandidate }>;
            pendingDuplicates: Array<{ draftIndex: number; matched: CommittedCandidate }>;
            enrichmentMatches: Array<{ draftIndex: number; matchedTransactionId: string }>;
          };
      const txResult = await app.db.transaction(async (tx) => {
        // Row-level lock on the portfolio itself so a concurrent confirm of an
        // overlapping source serialises behind us (#B11). The second confirm
        // blocks on FOR UPDATE, then sees our commit (or our classification)
        // before classifying its own drafts. Locking the portfolio row — not
        // the (possibly empty) `transactions` set — is what closes the race:
        // when neither confirm has written anything yet, locking zero rows
        // would let both proceed.
        await tx.execute(
          sql`SELECT 1 FROM ${portfolios} WHERE ${portfolios.id} = ${targetPortfolioId} FOR UPDATE`,
        );

        const classification = await classifyDraftDuplicates(
          { db: tx, log: request.log },
          {
            resolved,
            targetPortfolioId,
            source,
            importId: imp.id,
          },
        );

        // Per-row dispositions win over the blanket `acknowledgeDuplicates` flag. The
        // client resolves one duplicate at a time ("skip" / "import" / "enrich"), which
        // is the only way to express "import the new trades, skip the ones I already have".
        const decisions = decideDuplicates({
          enrichmentMatches: classification.enrichmentMatches,
          plainDuplicates: classification.plainDuplicates,
          pendingDuplicates: classification.pendingDuplicates,
          resolutions,
          acknowledgeDuplicates,
        });
        const { enrichmentMatches } = decisions;

        request.log.info(
          {
            importId: imp.id,
            likelyDuplicates: decisions.counts.duplicates,
            pendingDuplicates: decisions.counts.pending,
            enrichments: decisions.counts.enrichments,
            acknowledged: acknowledgeDuplicates,
            resolutions: resolutions.length,
          },
          "confirm: cross-source duplicates among selected drafts",
        );

        if (decisions.blockedPlain.length > 0 || decisions.blockedPending.length > 0) {
          // Don't write anything — surface the 409 to the caller. Committing
          // here is fine; this is a read-only tx (the FOR UPDATE lock is
          // released on commit, not rollback).
          return {
            kind: "duplicate",
            plainDuplicates: decisions.blockedPlain,
            pendingDuplicates: decisions.blockedPending,
            enrichmentMatches,
          } satisfies TxResult;
        }

        // Pass 2 — write the (non-enrichment) drafts as new transactions + source rows.
        // Confirm writes status="normal"; the shared writer is also used by sync with "draft".
        const skipDraftIndices = new Set<number>([
          ...decisions.enrichmentMatches.map((m) => m.draftIndex),
          ...decisions.skippedIndices,
        ]);
        const {
          written: draftRows,
          attempted: draftAttempted,
          skipped: draftSkipped,
        } = await writeResolvedDrafts(tx, {
          resolved,
          // Skipped: enrichment matches (folded into the matched row instead), cash
          // movements excluded by the cash-outside gate, and drafts the user explicitly
          // skipped. Acknowledged plain duplicates are still inserted (the user opted in
          // via acknowledgeDuplicates → 409 cleared, or via a per-row "import").
          skipDraftIndices,
          targetPortfolioId,
          source,
          importId: imp.id,
          status: "normal",
        });
        attempted += draftAttempted;
        skipped += draftSkipped;
        const written = [...draftRows];

        // Enrichment runs inside the write transaction: the matched row is updated with the
        // incoming document's tax/fees atomically with the rest of the import. A failure
        // aborts the transaction, so a draft is never "skipped and not enriched" — the
        // import stays unconfirmed and the user can retry.
        for (const { draftIndex, matchedTransactionId } of enrichmentMatches) {
          const { draft } = resolved[draftIndex];
          await enrichTransactionFromDrafts(matchedTransactionId, tx, [draft], {
            importId: imp.id,
            importSource: source,
          });
        }

        // Financed gold contracts: create the gold instrument + loan, then insert
        // the derived legs (buy, drawdown, admin/discount fees, due installments),
        // all linked by loanId so the outstanding balance derives in @portfolio/core.
        if (contracts.length > 0) {
          const goldResult = await writeGoldContracts(tx, {
            contracts,
            targetPortfolioId,
            importId: imp.id,
            source,
            requestLog: request.log,
          });
          written.push(...goldResult.written);
          attempted += goldResult.attempted;
        }

        const staged = Array.isArray(parsed.drafts) ? parsed.drafts : [];
        const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
        const confirmedExtIds = new Set(
          drafts.map((d) => d.externalId).filter((x): x is string => Boolean(x)),
        );

        const isSyncImport = imp.parser === "pytr" || imp.parser === "ibkr";
        if (isSyncImport) {
          const resolvedSource = imp.parser as "pytr" | "ibkr";
          // Record confirmed events durably so a later manual deletion doesn't resurface them.
          if (confirmedExtIds.size) {
            await tx
              .insert(trResolvedEvents)
              .values(
                [...confirmedExtIds].map((eventId) => ({
                  portfolioId: targetPortfolioId,
                  source: resolvedSource,
                  eventId,
                  resolution: "confirmed",
                })),
              )
              .onConflictDoNothing();
          }
          // Pass-based confirm: keep the import open while drafts or *actionable* issues
          // remain (ignorable `info` issues don't hold it open); close it otherwise.
          const remaining = staged.filter(
            (d) => !(d.externalId && confirmedExtIds.has(d.externalId)),
          );
          const remainingErrors = errors.filter(
            (e) => !(e.eventId && confirmedExtIds.has(e.eventId)),
          );
          const remainingAttention = remainingErrors.filter((e) => e.severity === "attention");

          if (remaining.length > 0 || remainingAttention.length > 0) {
            await tx
              .update(screenshotImports)
              .set({
                portfolioId: targetPortfolioId,
                parsedJson: { ...parsed, drafts: remaining, errors: remainingErrors },
              })
              .where(eq(screenshotImports.id, imp.id));
            finalStatus = "draft";
          } else {
            // Closing: record any leftover (ignorable) issues as resolved so the next sync
            // doesn't re-surface them.
            const leftover = remainingErrors
              .map((e) => e.eventId)
              .filter((x): x is string => Boolean(x));
            if (leftover.length) {
              await tx
                .insert(trResolvedEvents)
                .values(
                  leftover.map((eventId) => ({
                    portfolioId: targetPortfolioId,
                    source: resolvedSource,
                    eventId,
                    resolution: "discarded",
                  })),
                )
                .onConflictDoNothing();
            }
            await tx
              .update(screenshotImports)
              .set({ portfolioId: targetPortfolioId, status: "confirmed" })
              .where(eq(screenshotImports.id, imp.id));
            finalStatus = "confirmed";
          }
        } else {
          // Other importers (CSV/screenshot/DKB): pass-based prune when drafts carry stable
          // ids, else all-or-nothing — unchanged behaviour, no durable ledger.
          const everyHasId = staged.length > 0 && staged.every((d) => Boolean(d.externalId));
          const remaining = everyHasId
            ? staged.filter((d) => !(d.externalId && confirmedExtIds.has(d.externalId)))
            : [];
          if (everyHasId && remaining.length > 0) {
            await tx
              .update(screenshotImports)
              .set({ portfolioId: targetPortfolioId, parsedJson: { ...parsed, drafts: remaining } })
              .where(eq(screenshotImports.id, imp.id));
            finalStatus = "draft";
          } else {
            await tx
              .update(screenshotImports)
              .set({ portfolioId: targetPortfolioId, status: "confirmed" })
              .where(eq(screenshotImports.id, imp.id));
            finalStatus = "confirmed";
          }
        }
        return {
          kind: "ok",
          written,
          enrichmentMatches,
          skippedDuplicates: decisions.counts.duplicates,
          pendingDuplicates: decisions.counts.pending,
        } satisfies TxResult;
      });

      if (txResult.kind === "duplicate") {
        const isoDay = (v: Date | string) =>
          (v instanceof Date ? v.toISOString() : new Date(v).toISOString()).slice(0, 10);
        // `draftIndex` is the index into the array the client submitted — the server no
        // longer filters that array before classifying, so the index always lines up.
        // `externalId` is the draft's stable identity and is what the client should
        // resolve against (the index is only advisory).
        const describe = (
          entry: { draftIndex: number; matched: CommittedCandidate },
          pending: boolean,
        ) => {
          const d = resolved[entry.draftIndex].draft;
          const m = entry.matched;
          return {
            draftIndex: entry.draftIndex,
            externalId: d.externalId ?? `import:${imp.id}:${entry.draftIndex}`,
            matchedTransactionId: m.id,
            name: d.name ?? d.isin ?? d.ticker ?? null,
            action: d.action,
            quantity: d.quantity,
            executedAt: isoDay(d.executedAt),
            matchedSource: m.source,
            matchedExecutedAt: isoDay(m.executedAt),
            pending,
          };
        };
        return reply.code(409).send({
          error: "duplicate_transactions",
          count: txResult.plainDuplicates.length + txResult.pendingDuplicates.length,
          duplicates: [
            ...txResult.plainDuplicates.map((d) => describe(d, false)),
            ...txResult.pendingDuplicates.map((d) => describe(d, true)),
          ],
        });
      }
      const created = txResult.written;
      const { enrichmentMatches } = txResult;
      const likelyDuplicates = txResult.skippedDuplicates;
      const pendingDuplicates = txResult.pendingDuplicates;

      const { enriched } = await finalizeConfirmedImport(app, {
        importId: imp.id,
        targetPortfolioId,
        created,
        isPytr,
        isDkbPdf,
        isTrPdf,
        enrichmentMatches,
        userId: id,
        requestLog: request.log,
      });
      request.log.info(
        {
          importId: imp.id,
          attempted,
          written: created.length,
          enriched,
          skipped,
          skippedDuplicates: likelyDuplicates,
          pendingDuplicates,
          finalStatus,
        },
        "confirm complete",
      );
      bumpImportListVersion(id);
      reply.code(201);
      return {
        confirmed: created.length,
        transactions: created,
        likelyDuplicates,
        pendingDuplicates,
        enriched,
        skipped,
      };
    },
  );
}
