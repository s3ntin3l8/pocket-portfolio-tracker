import { cashFlow } from "@portfolio/core";
import type { CoreTransaction } from "@portfolio/core";
import { cn } from "@/lib/utils";
import type { ColDef } from "@/lib/table-sort";
import {
  type TxRow,
  TYPE_ICON,
  KIND_ICON,
  TYPE_TONE_CLASSES,
  SRC_TONES,
  sourceTypesFor,
} from "./types";

export type { TxRow };

export function SourceChips({
  tx,
  t,
  chipClassName,
}: {
  tx: TxRow;
  t: (key: `sources.${string}`) => string;
  chipClassName: string;
}) {
  return (
    <>
      {sourceTypesFor(tx).map((type) => (
        <span key={type} className={chipClassName} style={SRC_TONES[type] ?? SRC_TONES.manual}>
          {t(`sources.${type}`)}
        </span>
      ))}
    </>
  );
}

export function TypeIconChip({
  type,
  kind,
  className,
}: {
  type: string;
  kind?: string | null;
  className?: string;
}) {
  const entry = (kind && KIND_ICON[kind]) ?? TYPE_ICON[type];
  if (!entry) return null;
  const Icon = entry.icon;
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]",
        TYPE_TONE_CLASSES[entry.tone],
        className,
      )}
      aria-hidden
    >
      <Icon className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

export function txNetAmount(tx: TxRow): number {
  const status = tx.status === "draft" ? "normal" : tx.status;
  return cashFlow({
    instrumentId: null,
    type: tx.type as CoreTransaction["type"],
    quantity: tx.quantity,
    price: tx.price,
    fees: tx.fees,
    currency: tx.currency,
    executedAt: new Date(tx.executedAt),
    status,
  }).toNumber();
}

export function txAmount(tx: TxRow): number {
  const qty = Number(tx.quantity);
  const price = Number(tx.price);
  return qty > 0 ? qty * price : price + (tx.tax ? Number(tx.tax) : 0);
}

export function displayRate(tx: TxRow): number {
  return tx.displayRate ? Number(tx.displayRate) : 1;
}

export function txAmountDisplay(tx: TxRow): number {
  return txAmount(tx) * displayRate(tx);
}

export function txNetAmountDisplay(tx: TxRow): number {
  return txNetAmount(tx) * displayRate(tx);
}

export function rowQuantityDisplay(tx: TxRow): string | null {
  if (Number(tx.quantity) > 0) return null;
  return tx.shares ?? null;
}

export function rowPerShareDisplay(
  tx: TxRow,
  m: (n: number, currency: string) => string,
): string | null {
  if (Number(tx.quantity) > 0) return null;
  if (tx.perShare == null) return null;
  return m(Number(tx.perShare), tx.nativeCurrency ?? tx.currency);
}

export const TX_COLS: ColDef<TxRow>[] = [
  { key: "date", get: (r) => r.executedAt, type: "date" },
  { key: "instrument", get: (r) => r.instrument?.symbol ?? r.type, type: "text" },
  { key: "portfolio", get: (r) => r.portfolioName ?? "", type: "text" },
  { key: "quantity", get: (r) => r.quantity, type: "numeric" },
  { key: "price", get: (r) => Number(r.price), type: "numeric" },
  { key: "tax", get: (r) => (r.tax != null ? Number(r.tax) : 0), type: "numeric" },
  { key: "netAmount", get: (r) => txNetAmount(r), type: "numeric" },
  { key: "source", get: (r) => r.source, type: "text" },
];
