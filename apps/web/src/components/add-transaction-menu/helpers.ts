import type { ApiClient } from "@portfolio/api-client";
import type { AddTransactionInitial } from "@/components/add-transaction-form";

export async function loadHarvestPrefill(
  api: ApiClient,
  instrumentId: string,
  portfolioId: string,
): Promise<AddTransactionInitial | null> {
  try {
    const [instrument, summary] = await Promise.all([
      api.getInstrument(instrumentId),
      portfolioId ? api.getSummary(portfolioId) : Promise.resolve(null),
    ]);
    const lots = summary?.holdings.find((h) => h.instrumentId === instrumentId)?.lots ?? [];
    const quantity =
      lots.length > 0 ? lots.reduce((sum, l) => sum + Number(l.qty), 0).toString() : "";
    return {
      type: "sell",
      instrumentId,
      instrument: {
        symbol: instrument.symbol,
        name: instrument.name,
        assetClass: instrument.assetClass,
        unit: instrument.unit,
      },
      quantity,
      price: "",
      fees: "",
      currency: instrument.currency,
      executedAt: new Date().toISOString().slice(0, 10),
    };
  } catch {
    return null;
  }
}
