/** Search param carrying the Holdings hero chart range. */
export const RANGE_PARAM = "range";

/** Ranges offered as chips by the Holdings hero chart (and accepted from `?range=`). */
export const HERO_RANGES = ["1d", "7d", "1m", "1y", "all"] as const;
export type HeroRange = (typeof HERO_RANGES)[number];

/** The day-grained default (intraday snapshots only backfill over time — see the hero). */
export const DEFAULT_HERO_RANGE: HeroRange = "1y";

export function isIntradayHeroRange(range: string): boolean {
  return range === "1d" || range === "7d";
}

/**
 * Resolve `?range=` to the range the hero should open on. Anything unknown falls back to
 * the default, and so does an intraday range when no intraday data exists (`hasIntraday`
 * is a definite `false`) — those chips are hidden then, so a deep link must not select one.
 * `hasIntraday === "unavailable"` (the check failed) keeps them, like the chips do.
 */
export function resolveHeroRange(
  param: string | null | undefined,
  hasIntraday: boolean | "unavailable" = true,
): HeroRange {
  if (!param || !(HERO_RANGES as readonly string[]).includes(param)) return DEFAULT_HERO_RANGE;
  if (isIntradayHeroRange(param) && hasIntraday === false) return DEFAULT_HERO_RANGE;
  return param as HeroRange;
}
