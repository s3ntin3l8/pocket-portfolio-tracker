/**
 * The one definition of how a signed number is toned. Zero, null and non-finite are always
 * neutral — a flat position is not a gain, so it never renders green (audit G3/F4). Don't
 * write `n >= 0 ? "text-success" : "text-destructive"` inline; that makes zero green.
 */

/** Direction of a gain figure — drives the value colour (green up / red down / neutral). */
export type Tone = "up" | "down" | "flat";

/** Same direction with the `neutral` spelling used by delta/trend props. */
export type DeltaTone = "up" | "down" | "neutral";

/** Tone of a signed number: positive up, negative down, zero/unknown flat. */
export const toneOf = (n: number | null | undefined): Tone =>
  n == null || !Number.isFinite(n) || n === 0 ? "flat" : n > 0 ? "up" : "down";

/** `toneOf` in the `up | down | neutral` spelling. */
export const deltaToneOf = (n: number | null | undefined): DeltaTone => {
  const t = toneOf(n);
  return t === "flat" ? "neutral" : t;
};

/** Text colour class for a tone. Flat deliberately yields "" so the figure inherits the
 *  surrounding colour; callers that want a muted flat state add `|| "text-muted-foreground"`. */
export const toneClass = (tone: Tone | DeltaTone): string =>
  tone === "up" ? "text-success" : tone === "down" ? "text-destructive" : "";

/** Background colour class for a tone (bars, dots); flat is muted. */
export const toneBgClass = (tone: Tone): string =>
  tone === "up" ? "bg-success" : tone === "down" ? "bg-destructive" : "bg-muted-foreground";

/** Text colour class for a signed number (flat inherits). */
export const signToneClass = (n: number | null | undefined): string => toneClass(toneOf(n));

/** Direction glyph for a signed number; flat has no arrow (empty string). */
export const trendGlyphOf = (n: number | null | undefined): string => {
  const t = toneOf(n);
  return t === "up" ? "▲" : t === "down" ? "▼" : "";
};
