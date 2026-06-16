import { cn } from "@/lib/utils";
import { resolveBrokerage, monogram, tintFor } from "@/lib/brokerages";

/**
 * Visual identifier for a portfolio's brokerage. Renders the bundled logo when the
 * brokerage is recognized (light/dark variants swapped via Tailwind `dark:` utilities,
 * so no theme JS is needed), otherwise a deterministic colored monogram. Renders nothing
 * for an empty/missing brokerage.
 *
 * Logos live in `public/brokerages/` — see `scripts/fetch-brokerage-icons.ts`.
 */
export function BrokerageIcon({
  brokerage,
  className,
}: {
  brokerage?: string | null;
  className?: string;
}) {
  const name = brokerage?.trim();
  if (!name) return null;

  const box = cn(
    "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md",
    className,
  );
  const def = resolveBrokerage(name);

  if (def?.icon) {
    const base = `/brokerages/${def.key}`;
    return (
      <span className={cn(box, "bg-muted")} role="img" aria-label={name} title={name}>
        {def.icon.variants ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- small bundled static SVG */}
            <img
              src={`${base}-dark.svg`}
              alt=""
              aria-hidden
              className="block size-full p-1 dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- small bundled static SVG */}
            <img
              src={`${base}-light.svg`}
              alt=""
              aria-hidden
              className="hidden size-full p-1 dark:block"
            />
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- small bundled static SVG
          <img src={`${base}.svg`} alt="" aria-hidden className="size-full p-1" />
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(box, "text-[0.7rem] font-semibold text-white")}
      style={{ backgroundColor: tintFor(name) }}
      role="img"
      aria-label={name}
      title={name}
    >
      {monogram(name)}
    </span>
  );
}
