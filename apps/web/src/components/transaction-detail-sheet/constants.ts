import type { LucideIcon } from "lucide-react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Coins,
  Receipt,
  Scale,
  Split,
} from "lucide-react";
import { tint } from "@/lib/tint";

export const TYPE_BADGE: Record<string, { icon: LucideIcon; bg: string; fg: string }> = {
  buy: { icon: ArrowRight, ...tint("primary") },
  savings_plan: { icon: ArrowRight, ...tint("primary") },
  sell: { icon: ArrowLeft, ...tint("destructive") },
  dividend: { icon: Coins, ...tint("gold") },
  coupon: { icon: Coins, ...tint("gold") },
  interest: { icon: ArrowDownLeft, ...tint("primary") },
  deposit: { icon: ArrowDownLeft, ...tint("primary") },
  bonus_cash: { icon: ArrowDownLeft, ...tint("primary") },
  loan_drawdown: { icon: ArrowDownLeft, ...tint("primary") },
  withdrawal: { icon: ArrowUpRight, ...tint("destructive") },
  fee: { icon: ArrowUpRight, ...tint("destructive") },
  tax: { icon: ArrowUpRight, ...tint("destructive") },
  loan_repayment: { icon: ArrowUpRight, ...tint("destructive") },
  split: { icon: Split, ...tint("violet") },
  bonus: { icon: Split, ...tint("violet") },
  rights: { icon: Split, ...tint("violet") },
  transfer_in: { icon: ArrowLeftRight, ...tint("teal") },
  transfer_out: { icon: ArrowLeftRight, ...tint("teal") },
  adjustment: { icon: Scale, ...tint("teal") },
};

export const DEFAULT_BADGE = { icon: Receipt, bg: "var(--border)", fg: "var(--text-mute)" };

/** Types whose breakdown uses the v2 design's income labels (Shares/Per share/Gross/Net
 *  income) instead of the trade ones (Quantity/Price·unit/Amount/Net Amount) — see
 *  `cards.tsx`'s `BreakdownCard`. A single named export so the set is discoverable and
 *  easy to extend (e.g. if `interest`/`bonus_cash` ever gain the same breakdown shape). */
export const INCOME_BREAKDOWN_TYPES = ["dividend", "coupon"] as const;

export const SOURCE_PILL: Record<string, { bg: string; fg: string }> = {
  screenshot: { ...tint("violet") },
  csv: { ...tint("teal") },
  pytr: { ...tint("teal") },
  pdf: { ...tint("destructive") },
};

export const DEFAULT_PILL = { bg: "var(--border)", fg: "var(--text-mute)" };

/** Hero "Draft" pill — shown alongside (not instead of) the source pill for a draft
 *  transaction. Gold, matching the app's other draft/pending accents. */
export const DRAFT_PILL = { ...tint("gold") };
