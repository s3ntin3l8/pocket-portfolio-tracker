"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { recordLastVisited } from "@/lib/last-visited";

/** Renders nothing; records each in-app navigation for the PWA restore-on-launch. */
export function LastVisitedTracker() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    recordLastVisited(pathname, search);
  }, [pathname, search]);
  return null;
}
