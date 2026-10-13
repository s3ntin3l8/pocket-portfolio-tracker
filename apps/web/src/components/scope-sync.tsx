"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { SCOPE_PARAM, effectiveScopeValue } from "@/lib/portfolio-selection";

/**
 * Keeps the `(app)` layout (sidebar net worth, switcher props) in step with the URL
 * scope. A search-param navigation doesn't re-render the layout, and browser
 * back/forward across two scopes restores the cached one, so the sidebar could show the
 * previous scope's figure. `serverScope` is the scope (cookie encoding) the layout was
 * rendered for; whenever the URL's effective scope differs, refresh once. The ref is
 * defensive: both sides resolve identically today, but it keeps a scope the server can't
 * settle on from refreshing in a loop.
 *
 * `document.cookie` is deliberately not an effect dependency: it only matters on
 * scope-less URLs, where `param` is null, and a cookie write (the switcher) is always
 * paired with a `?scope=` push that changes `param`.
 */
export function ScopeSync({ serverScope }: { serverScope: string }) {
  const router = useRouter();
  const param = useSearchParams().get(SCOPE_PARAM);
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    const urlScope = effectiveScopeValue(param, document.cookie) ?? "all";
    if (urlScope === serverScope) {
      refreshedFor.current = null;
      return;
    }
    if (refreshedFor.current === urlScope) return;
    refreshedFor.current = urlScope;
    router.refresh();
  }, [param, serverScope, router]);

  return null;
}
