import { isTradeType } from "@portfolio/core";
import type {
  DraftAttention,
  ParsedAction,
  ImportIssue,
  ParsedTransaction,
} from "@portfolio/schema";
import { Decimal } from "decimal.js";
import { formatDec, formatDecimal } from "../parsers/numeric.js";
import { collapsePerkFundedAcquisitions } from "../parsers/perk-pairing.js";
import {
  trEventSchema,
  type TrEvent,
  TR_CRYPTO_ISIN,
  RECONCILE_TOLERANCE,
  EVENT_KIND,
  FIXED_ACTIONS,
  TRADE_EVENTS,
  CASH_BY_SIGN,
  CASH_CORPORATE_ACTION,
  SHARE_CORPORATE_ACTION,
  NO_CASH_CORPORATE_ACTION,
  SKIP_EVENTS,
  ATTENTION_SKIPS,
  SECURITY_ACTIONS,
} from "./mapper/taxonomy.js";

import type { MapResult } from "./mapper/classification.js";
export {
  categoryForEventType,
  isCashMovementEvent,
  isCashMovementAction,
} from "./mapper/classification.js";
export type { ImportCategory, MapResult } from "./mapper/classification.js";
export type { ReportDocumentRef } from "./mapper/reports.js";
export { extractReportDocuments } from "./mapper/reports.js";
export { REPORT_TITLE_PREFIXES, REPORT_TITLE_YEAR_RE } from "./mapper/taxonomy.js";
export {
  RECLASSIFICATION_ORIGINAL_SUFFIX,
  rawEventIdFromExternalId,
} from "./mapper/reclassification.js";
import { buildReclassificationSplit } from "./mapper/reclassification.js";

function skip(
  reason: string,
  severity: "info" | "attention",
  ev?: TrEvent,
  code?: ImportIssue["code"],
): MapResult {
  if (!ev) return { skip: true, reason, severity, code };
  return {
    skip: true,
    reason,
    severity,
    code,
    eventId: ev.id,
    eventType: ev.eventType,
    raw: {
      isin: ev.isin ?? null,
      name: ev.title ?? null,
      currency: ev.currency?.toUpperCase() ?? null,
      executedAt: ev.timestamp,
      amount: ev.amount,
      shares: ev.shares ?? null,
    },
  };
}

export function mapTrEventToDraft(raw: unknown): MapResult {
  const parsed = trEventSchema.safeParse(raw);
  if (!parsed.success) {
    return skip(
      `unparseable event: ${parsed.error.issues[0]?.message}`,
      "attention",
      undefined,
      "unparseable_event",
    );
  }
  const ev = parsed.data;

  if (ev.status && ev.status.toUpperCase() !== "EXECUTED") {
    return skip(`non-executed event (${ev.status})`, "info", ev);
  }

  const skipReason = SKIP_EVENTS.get(ev.eventType);
  if (skipReason) {
    return skip(skipReason, ATTENTION_SKIPS.has(ev.eventType) ? "attention" : "info", ev);
  }

  let action: ParsedAction | undefined = FIXED_ACTIONS[ev.eventType];
  if (!action && TRADE_EVENTS.has(ev.eventType)) {
    action = ev.amount < 0 ? "buy" : "sell";
  }
  if (!action && CASH_BY_SIGN.has(ev.eventType)) {
    action = ev.amount < 0 ? "withdrawal" : "deposit";
  }
  if (!action && ev.eventType === CASH_CORPORATE_ACTION) {
    action = ev.isin ? "dividend" : "deposit";
  }
  if (!action && ev.eventType === SHARE_CORPORATE_ACTION) {
    action = ev.amount !== 0 ? "buy" : "bonus";
  }
  if (!action && ev.eventType === NO_CASH_CORPORATE_ACTION && ev.kind === "vorabpauschale") {
    action = "tax";
  }
  if (!action) {
    return skip(`unmapped event type: ${ev.eventType}`, "attention", ev, "unmapped_event_type");
  }

  const amount = Math.abs(ev.amount);
  const fees = Math.abs(ev.fees ?? 0);
  const isSecurity = SECURITY_ACTIONS.has(action);

  if (isSecurity && !ev.isin) {
    return skip(`${ev.eventType} without an ISIN`, "attention", ev);
  }

  let quantity = "0";
  let price = formatDecimal(amount);
  let confidence = 1;
  let sellTaxOverride: Decimal | null = null;
  let attention: DraftAttention[] | null = null;

  if (isTradeType(action)) {
    const shares = Math.abs(ev.shares ?? 0);
    if (shares === 0) {
      return skip(`${ev.eventType} without a share count`, "attention", ev);
    }
    quantity = formatDecimal(shares);
    // Reconstructed per-share price / withheld tax are stored money: Decimal throughout
    // (audit B12), only the original event numbers enter as JS values.
    const sharesD = new Decimal(shares);
    const amountD = new Decimal(amount);
    const feesD = new Decimal(fees);
    if (action === "sell") {
      if (ev.executedPrice != null) {
        price = formatDecimal(Math.abs(ev.executedPrice));
        const notional = sharesD.mul(Math.abs(ev.executedPrice));
        // ROUND_HALF_CEIL = Math.round's half-toward-+∞, so the cents match the old
        // float path exactly whenever float arithmetic didn't drift.
        sellTaxOverride = notional
          .sub(feesD)
          .sub(amountD)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_CEIL);
      } else {
        const sellTax = new Decimal(Math.abs(ev.tax ?? 0));
        price = formatDec(amountD.add(feesD).add(sellTax).div(sharesD));
      }
    } else {
      price = formatDec(amountD.sub(feesD).div(sharesD));
    }

    if (ev.executedPrice != null && amount > 0) {
      const notional = shares * Math.abs(ev.executedPrice);
      if (Math.abs(notional - amount) > Math.max(amount * RECONCILE_TOLERANCE, 0.5)) {
        confidence = 0.5;
      }
    }
  }

  if (action === "transfer_in" || action === "transfer_out") {
    const shares = Math.abs(ev.shares ?? 0);
    if (shares === 0) {
      return skip(`${ev.eventType} without a share count`, "attention", ev);
    }
    quantity = formatDecimal(shares);
    // A transfer is cash-neutral: TR's event carries no acquisition price (the exporter
    // has no carried-cost field, and `executedPrice` — if a detail row happens to carry
    // one — is not the user's cost basis, so it is deliberately NOT used: a silently
    // wrong "known" basis is worse than an unknown one). An inbound transfer therefore
    // lands as a flagged draft the user completes in the review screen; confirm refuses
    // it at price 0 (audit B4). An outbound transfer's row price is never read — the
    // shares leave at their running average cost — so it needs no flag.
    price = "0";
    if (action === "transfer_in") {
      confidence = 0.5;
      attention = ["needs_cost_basis"];
    }
  }

  if (action === "bonus") {
    const shares = Math.abs(ev.shares ?? 0);
    if (shares === 0) {
      return skip(
        `${ev.eventType} without a share count — check the event details`,
        "attention",
        ev,
      );
    }
    quantity = formatDecimal(shares);
    price = "0";
  }

  if (action === "tax") {
    price = formatDecimal(amount !== 0 ? amount : Math.abs(ev.tax ?? 0));
    quantity = "0";
    if (ev.kind === "vorabpauschale" && ev.vorabBase == null) {
      confidence = 0.5;
    }
  }

  const assetClass = ev.isin && TR_CRYPTO_ISIN.test(ev.isin) ? "crypto" : "equity";

  const draft: ParsedTransaction = {
    assetClass,
    action,
    ticker: null,
    isin: ev.isin ?? null,
    wkn: ev.wkn ?? null,
    name: ev.title ?? ev.isin ?? ev.eventType,
    quantity,
    unit: "shares",
    price,
    fees: formatDecimal(fees),
    total: formatDecimal(amount),
    currency: ev.currency.toUpperCase(),
    executedAt: new Date(ev.timestamp),
    confidence,
    externalId: ev.id,
    savingsPlanId: ev.savingsPlanId ?? null,
    exchangeCode: null,
    kind:
      ev.kind ??
      (ev.eventType === SHARE_CORPORATE_ACTION && action === "buy"
        ? "reinvestment"
        : (EVENT_KIND[ev.eventType] ?? null)),
    tax:
      action === "tax"
        ? null
        : sellTaxOverride != null
          ? formatDec(sellTaxOverride)
          : ev.tax != null
            ? formatDecimal(Math.abs(ev.tax))
            : null,
    executedPrice: ev.executedPrice != null ? formatDecimal(ev.executedPrice) : null,
    fxRate: ev.fxRate != null ? formatDecimal(ev.fxRate) : null,
    venue: ev.venue ?? null,
    description: ev.description ?? null,
    documentRefs: ev.documentRefs ?? null,
    vorabBase: ev.vorabBase != null ? formatDecimal(ev.vorabBase) : null,
    ...(attention ? { attention } : {}),
  };
  return { draft };
}

export function mapTrEvents(rawEvents: unknown[]): {
  drafts: ParsedTransaction[];
  errors: ImportIssue[];
} {
  const drafts: ParsedTransaction[] = [];
  const errors: ImportIssue[] = [];
  rawEvents.forEach((raw, i) => {
    const result = mapTrEventToDraft(raw);
    if ("draft" in result) {
      const parsed = trEventSchema.safeParse(raw);
      const ev = parsed.success ? parsed.data : null;
      const split = ev ? buildReclassificationSplit(ev) : null;
      if (split) {
        drafts.push(...split);
      } else if (ev && ev.originalAmount != null && ev.correctionAmount != null) {
        drafts.push({ ...result.draft, kind: "reclassification-unresolved" });
      } else {
        drafts.push(result.draft);
      }
    } else
      errors.push({
        line: i,
        message: result.reason,
        severity: result.severity,
        code: result.code,
        eventId: result.eventId,
        eventType: result.eventType,
        raw: result.raw,
      });
  });
  return { drafts: collapsePerkFundedAcquisitions(drafts), errors };
}
