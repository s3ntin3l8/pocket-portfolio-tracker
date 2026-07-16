import type { ImportDraft, ImportIssue, ReviewDraft } from "@/components/import-flow/types";
import type { ColDef } from "@/lib/table-sort";

export type { ImportDraft, ImportIssue, ReviewDraft };

export interface ImportReviewGroup {
  importId: string;
  filename: string;
}

export interface ImportTargetPortfolio {
  id: string;
  name: string;
  brokerage: string | null;
  accountHolder: string | null;
}

export interface ImportReviewProps {
  drafts: ReviewDraft[];
  onUpdate: (uid: string, patch: Partial<ImportDraft>) => void;
  onRemove: (uid: string) => void;
  onRemoveMany: (uids: string[]) => void;
  onConfirm: (uids?: string[]) => void | Promise<void>;
  isSubmitting?: boolean;
  onDiscard: () => void | Promise<void>;
  issues?: ImportIssue[];
  onMapIssue?: (eventId: string, draft: ImportDraft) => void;
  groups?: ImportReviewGroup[];
  portfolios?: ImportTargetPortfolio[];
  portfolioByImport?: Map<string, string>;
  onPortfolioChange?: (importId: string, portfolioId: string) => void;
  issuesByImport?: Map<string, ImportIssue[]>;
}

export const MAP_ACTIONS = [
  "buy",
  "sell",
  "bonus",
  "dividend",
  "coupon",
  "interest",
  "savings_plan",
  "deposit",
  "withdrawal",
] as const;

export const REVIEW_COLS: ColDef<ReviewDraft>[] = [
  { key: "confidence", get: (d) => d.confidence, type: "numeric" },
  { key: "assetClass", get: (d) => d.assetClass, type: "text" },
  { key: "action", get: (d) => d.action, type: "text" },
  { key: "name", get: (d) => d.name ?? "", type: "text" },
  { key: "isin", get: (d) => d.isin ?? "", type: "text" },
  { key: "wkn", get: (d) => d.wkn ?? "", type: "text" },
  { key: "executedAt", get: (d) => d.executedAt, type: "date" },
  { key: "quantity", get: (d) => d.quantity, type: "numeric" },
  { key: "price", get: (d) => d.price, type: "numeric" },
  { key: "total", get: (d) => d.total ?? "", type: "numeric" },
  { key: "fees", get: (d) => d.fees ?? "", type: "numeric" },
];

export const TABLE_COL_COUNT = 14;

export function fmtQty(s: string): string {
  const n = parseFloat(s);
  if (!isFinite(n)) return s;
  return n.toFixed(4).replace(/\.?0+$/, "") || "0";
}

export function fmtAmt(s: string): string {
  const n = parseFloat(s);
  if (!isFinite(n)) return s;
  return n.toFixed(2);
}
