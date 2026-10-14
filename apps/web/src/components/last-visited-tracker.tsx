"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { recordLastVisited } from "@/lib/last-visited";
import { recordRecentPage } from "@/lib/recent-pages";
import { COMMAND_PAGES } from "@/components/nav-items";

const KNOWN_PATHS = COMMAND_PAGES.map((p) => p.href);

/** Renders nothing; records each in-app navigation for the PWA restore-on-launch. */
export function LastVisitedTracker() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    recordLastVisited(pathname, search);
    recordRecentPage(pathname, KNOWN_PATHS);
  }, [pathname, search]);
  return null;
}
