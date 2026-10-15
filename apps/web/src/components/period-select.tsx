"use client";

import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The URL for switching a period param: `next === defaultValue` drops the param (the
 * default period is an absent param, keeping the default URL clean). Shared with the
 * command bar's per-page year commands so both write identical URLs.
 */
export function buildPeriodHref(
  pathname: string,
  currentQuery: string,
  param: string,
  next: string,
  defaultValue: string,
): string {
  const params = new URLSearchParams(currentQuery);
  if (next === defaultValue) params.delete(param);
  else params.set(param, next);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Period (year) selector backed by a URL search param (`?year=` by default) — the URL is
 * the state, so a period is shareable, survives reload and PWA restore. The server page
 * reads the param, so a change is a `router.replace` (no history entry, no scroll jump)
 * that re-renders the page for the new period. `defaultValue` (e.g. the current year) is
 * represented by an absent param, keeping the default URL clean.
 */
export function PeriodSelect({
  value,
  options,
  defaultValue,
  label,
  param = "year",
  className,
}: {
  /** The period the server rendered. */
  value: string;
  options: readonly string[];
  defaultValue: string;
  label: string;
  param?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    router.replace(
      buildPeriodHref(pathname, searchParams?.toString() ?? "", param, next, defaultValue),
      { scroll: false },
    );
  }

  return (
    <label
      className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm font-semibold text-foreground"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
