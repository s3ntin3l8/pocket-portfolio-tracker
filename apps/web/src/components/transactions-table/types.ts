import { tintStyle } from "@/lib/tint";
import {
  ScanLine,
  FileSpreadsheet,
  PencilLine,
  Landmark,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowRightLeft,
  ArrowLeftRight,
  Coins,
  Gem,
  Split,
  GitMerge,
  Scale,
  Gift,
  PiggyBank,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SourceSummary, TransactionStatus } from "@portfolio/api-client";

export const SOURCE_ICON: Record<string, LucideIcon> = {
  screenshot: ScanLine,
  csv: FileSpreadsheet,
  manual: PencilLine,
  pytr: Landmark,
  pdf: FileSpreadsheet,
  ibkr: Landmark,
};

export const TYPE_ICON: Record<
  string,
  { icon: LucideIcon; tone: "success" | "destructive" | "warning" | "violet" | "teal" }
> = {
  buy: { icon: ArrowDownToLine, tone: "success" },
  savings_plan: { icon: ArrowDownToLine, tone: "success" },
  sell: { icon: ArrowUpFromLine, tone: "destructive" },
  dividend: { icon: Coins, tone: "warning" },
  coupon: { icon: Coins, tone: "warning" },
  deposit: { icon: ArrowDownCircle, tone: "success" },
  interest: { icon: ArrowDownCircle, tone: "success" },
  bonus_cash: { icon: ArrowDownCircle, tone: "success" },
  loan_drawdown: { icon: ArrowDownCircle, tone: "success" },
  withdrawal: { icon: ArrowUpCircle, tone: "destructive" },
  fee: { icon: ArrowUpCircle, tone: "destructive" },
  tax: { icon: ArrowUpCircle, tone: "destructive" },
  loan_repayment: { icon: ArrowUpCircle, tone: "destructive" },
  bonus: { icon: Gem, tone: "violet" },
  rights: { icon: Gem, tone: "violet" },
  split: { icon: Split, tone: "violet" },
  transfer_in: { icon: ArrowRightLeft, tone: "teal" },
  transfer_out: { icon: ArrowLeftRight, tone: "teal" },
  merger: { icon: GitMerge, tone: "teal" },
  adjustment: { icon: Scale, tone: "teal" },
};

export const KIND_ICON: Record<
  string,
  { icon: LucideIcon; tone: "success" | "destructive" | "warning" | "violet" | "teal" }
> = {
  saveback: { icon: Gift, tone: "violet" },
  roundup: { icon: PiggyBank, tone: "success" },
  crypto_bonus: { icon: Sparkles, tone: "violet" },
  reinvestment: { icon: RefreshCw, tone: "success" },
};

export const TYPE_TONE_CLASSES = {
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  violet: "bg-violet/15 text-violet",
  teal: "bg-chart-3/15 text-chart-3",
} as const;

export const SRC_TONES: Record<string, React.CSSProperties> = {
  csv: tintStyle("teal"),
  pdf: tintStyle("destructive"),
  screenshot: tintStyle("violet"),
  pytr: tintStyle("teal"),
  ibkr: tintStyle("teal"),
  manual: { background: "var(--border)", color: "var(--text-mute)" },
};

export function sourceTypesFor(tx: TxRow): string[] {
  const types = (tx.sources ?? []).map((s) => s.sourceType).filter(Boolean);
  return types.length > 0 ? [...new Set(types)] : [tx.source];
}

export interface TxRow {
  id: string;
  portfolioId: string;
  portfolioName?: string;
  type: string;
  quantity: string;
  price: string;
  fees: string;
  tax?: string | null;
  fxRate?: string | null;
  perShare?: string | null;
  shares?: string | null;
  nativeCurrency?: string | null;
  grossNative?: string | null;
  sharesEstimated?: boolean;
  currency: string;
  displayRate?: string | null;
  /** No FX rate into the display currency: shown native, no displayRate (audit B2). */
  fxMissing?: boolean;
  displayCurrency?: string | null;
  executedAt: string;
  source: string;
  /** The cicilan loan a loan_repayment belongs to, and the installment it settles. */
  loanId?: string | null;
  installmentN?: number | null;
  instrument: {
    symbol?: string | null;
    name?: string | null;
    displayName?: string | null;
    assetClass?: string | null;
    unit?: string | null;
  } | null;
  instrumentId?: string | null;
  description?: string | null;
  tags?: string[] | null;
  kind?: string | null;
  hasDocument?: boolean;
  externalId?: string | null;
  hasFullTaxDetail?: boolean;
  sources?: SourceSummary[];
  status?: TransactionStatus;
  needsReview?: boolean;
}
