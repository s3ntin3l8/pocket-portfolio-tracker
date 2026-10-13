"use client";

import { useCallback, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { withScope } from "@/lib/portfolio-selection";

/** `withScope` bound to the current URL's search params. */
export function useScopedHref(): (href: string) => string {
  const searchParams = useSearchParams();
  return useCallback((href: string) => withScope(href, searchParams), [searchParams]);
}

/**
 * Locale-aware `Link` that carries the `?scope=` visible in the current URL onto its
 * (internal) target, so nav, report cards, back links and instrument links keep the scope
 * the user was looking at. Identical to `Link` when the URL has no scope.
 */
export function ScopeLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const scoped = useScopedHref();
  return <Link href={typeof href === "string" ? scoped(href) : href} {...rest} />;
}
