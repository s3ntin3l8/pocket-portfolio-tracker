import { toDateKey, toMonthKey } from "@portfolio/core";
import type { ProviderUsageView } from "./types.js";

export const callCounts = new Map<string, number>();

export function recordCall(name: string): void {
  callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
}

export function drainCallCounts(): [string, number][] {
  const drained = [...callCounts.entries()];
  callCounts.clear();
  return drained;
}

export const USAGE_TTL_MS = 60_000;

let _usageCache: { at: number; data: Record<string, ProviderUsageView> } | null = null;

export function readUsageCache(): { at: number; data: Record<string, ProviderUsageView> } | null {
  return _usageCache;
}

export function writeUsageCache(
  val: { at: number; data: Record<string, ProviderUsageView> } | null,
): void {
  _usageCache = val;
}

export function clearUsageCache(): void {
  _usageCache = null;
}

export const todayKey = toDateKey;
export const monthKey = toMonthKey;
