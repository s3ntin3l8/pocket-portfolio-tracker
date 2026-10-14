"use client";

import { ViewTransition } from "react";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { instrumentLogoTransitionName } from "@/lib/instrument-logo-transition";

/**
 * Logo slot in the instrument page's loading skeleton. The page is dynamic and suspends on
 * navigation, so the first commit at the destination is this skeleton, not the real header;
 * carrying the same `<ViewTransition name>` here gives the holdings-row logo something to
 * morph into (`instrument-logo.tsx`'s `transitionName`).
 */
export function InstrumentLogoPlaceholder() {
  const { id } = useParams<{ id?: string }>();
  const skeleton = <Skeleton className="size-11 shrink-0 rounded-md" />;
  if (!id) return skeleton;
  return (
    <ViewTransition name={instrumentLogoTransitionName(id)} share="vt-logo" default="none">
      {skeleton}
    </ViewTransition>
  );
}
