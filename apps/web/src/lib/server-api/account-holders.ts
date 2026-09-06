import type { AccountHolder } from "@portfolio/api-client";
import { getServerApi, listAccountHoldersCached } from "./_shared";

export async function loadAccountHolders(): Promise<AccountHolder[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    return await listAccountHoldersCached();
  } catch {
    return [];
  }
}

export async function loadLossCarryforward(
  holderId: string,
  taxYear: number,
): Promise<{ stock: string; general: string }> {
  const api = await getServerApi();
  if (!api) return { stock: "0", general: "0" };
  try {
    const res = await api.getLossCarryforward(holderId, taxYear);
    const stock = res.entries.find((e) => e.pot === "stock")?.amount ?? "0";
    const general = res.entries.find((e) => e.pot === "general")?.amount ?? "0";
    return { stock, general };
  } catch {
    return { stock: "0", general: "0" };
  }
}
