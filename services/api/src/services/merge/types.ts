export type MergeBlockReason =
  "not_found" | "same_transaction" | "different_instrument" | "incompatible_type" | "loan_linked";

export class MergeBlockedError extends Error {
  constructor(public readonly reason: MergeBlockReason) {
    super(`cannot_merge_${reason}`);
  }
}

export interface MergePreview {
  ok: boolean;
  blockedReason?: MergeBlockReason;
  merged?: {
    quantity: string;
    price: string;
    executedAt: string;
    type: string;
    currency: string;
    tax: string | null;
    fees: string | null;
    executedPrice: string | null;
    fxRate: string | null;
    venue: string | null;
    perShare: string | null;
    shares: string | null;
    nativeCurrency: string | null;
    grossNative: string | null;
    vorabBase: string | null;
    documentCount: number;
  };
}

export interface MergeResult {
  survivorId: string;
  recompute: Array<{ portfolioId: string; day: string }>;
}
