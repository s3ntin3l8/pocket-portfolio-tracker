"use client";

import { useEffect } from "react";
import { recordRecentInstrument } from "@/lib/recent-instruments";

/** Renders nothing; remembers `{ id, symbol }` for the command bar's Recent group. */
export function InstrumentVisitTracker({ id, symbol }: { id: string; symbol: string }) {
  useEffect(() => {
    recordRecentInstrument({ id, symbol });
  }, [id, symbol]);
  return null;
}
