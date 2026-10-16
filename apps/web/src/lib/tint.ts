/**
 * Tinted-badge colours derived from the theme tokens in `globals.css` — a translucent
 * background plus a solid foreground of the same hue. Use this instead of hand-written
 * `rgba(...)`/hex pairs wherever a style object (not a Tailwind class) needs the colours;
 * in class strings prefer `bg-primary/15 text-primary-strong` and friends.
 *
 * The values are plain CSS strings (`var()` / `color-mix()`), so they follow the active
 * light/dark theme with no JS involvement.
 */
export type TintTone =
  "primary" | "destructive" | "gold" | "warning" | "violet" | "teal" | "info" | "orange" | "slate";

const TONE_VAR: Record<TintTone, string> = {
  primary: "var(--primary)",
  destructive: "var(--destructive)",
  gold: "var(--gold-fg)",
  warning: "var(--warning)",
  violet: "var(--violet)",
  teal: "var(--chart-3)",
  info: "var(--info)",
  orange: "var(--orange)",
  slate: "var(--chart-5)",
};

/** Default tint opacity (percent) per tone — the weights the hand-written badges used. */
const TINT_ALPHA: Record<TintTone, number> = {
  primary: 14,
  destructive: 13,
  gold: 16,
  warning: 15,
  violet: 16,
  teal: 16,
  info: 14,
  orange: 16,
  slate: 16,
};

/** `color-mix` of a token at `pct` percent over transparent. */
export function mixAlpha(cssColor: string, pct: number): string {
  return `color-mix(in srgb, ${cssColor} ${pct}%, transparent)`;
}

/** `{ bg, fg }` for a tinted badge / icon chip of the given tone (bg at `pct`% opacity, default per tone). */
export function tint(tone: TintTone, pct = TINT_ALPHA[tone]): { bg: string; fg: string } {
  const fg = TONE_VAR[tone];
  return { bg: mixAlpha(fg, pct), fg };
}

/** Same as {@link tint} but shaped as inline-style properties (`background` / `color`). */
export function tintStyle(
  tone: TintTone,
  pct = TINT_ALPHA[tone],
): { background: string; color: string } {
  const { bg, fg } = tint(tone, pct);
  return { background: bg, color: fg };
}
