"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { RESTORE_TRIED_KEY, isStandaloneLaunch, readLastVisited } from "@/lib/last-visited";

/**
 * Mounted on the `/` landing: when the installed PWA launches, jump to the last visited
 * `(app)` URL. Browser tabs are untouched, and it runs at most once per session — if the
 * session has expired the app layout bounces back here, and the guard stops a loop.
 */
export function PwaRestore() {
  const router = useRouter();
  useEffect(() => {
    if (!isStandaloneLaunch()) return;
    try {
      if (sessionStorage.getItem(RESTORE_TRIED_KEY) === "1") return;
      sessionStorage.setItem(RESTORE_TRIED_KEY, "1");
    } catch {
      return;
    }
    const target = readLastVisited();
    if (target) router.replace(target);
  }, [router]);
  return null;
}
