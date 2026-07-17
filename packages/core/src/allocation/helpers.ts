import { Decimal } from "decimal.js";
import type { AllocationSlice } from "./types.js";

export function add(map: Map<string, Decimal>, key: string, val: Decimal): void {
  map.set(key, (map.get(key) ?? new Decimal(0)).add(val));
}

function toPct(slice: Decimal, total: Decimal): number {
  if (total.isZero()) return 0;
  return slice.div(total).mul(100).toDecimalPlaces(4).toNumber();
}

export function sortedSlices(map: Map<string, Decimal>, total: Decimal): AllocationSlice[] {
  return [...map.entries()]
    .map(([key, val]) => ({ key, value: val.toString(), pct: toPct(val, total) }))
    .sort((a, b) => b.pct - a.pct);
}
