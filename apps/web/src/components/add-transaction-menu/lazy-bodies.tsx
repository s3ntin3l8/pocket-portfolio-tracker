"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";

/**
 * Code-split bodies of the add-entry overlay (audit D11). `AppShell` mounts
 * `AddTransactionMenu` on every page, so statically importing the import flow, the
 * manual-entry form tabs and the portfolio/holder forms put all of them (and their
 * validation, date-picker, parsing and upload code) into the first-load JS of every
 * route. Each body only renders once its step is open, so it is fetched then (and
 * pre-warmed on hover/focus of the Add button via {@link preloadAddMenuBodies}).
 *
 * `ssr: false`: these only ever mount inside an open dialog (never in the server HTML).
 */
const loading = () => (
  <div className="flex justify-center py-10" role="status" aria-live="polite">
    <Spinner size="md" className="text-muted-foreground" />
  </div>
);

const loadImportFlow = () =>
  import("@/components/import-flow-client").then((m) => m.ImportFlowClient);
const loadNewEntryTabs = () => import("@/components/new-entry-tabs").then((m) => m.NewEntryTabs);

export const LazyImportFlowClient = dynamic(loadImportFlow, { ssr: false, loading });
export const LazyNewEntryTabs = dynamic(loadNewEntryTabs, { ssr: false, loading });
export const LazyPortfolioFormBody = dynamic(
  () => import("@/components/portfolio-form-dialog/body").then((m) => m.PortfolioFormBody),
  { ssr: false, loading },
);
export const LazyHolderFormBody = dynamic(
  () => import("@/components/holder-form-dialog/body").then((m) => m.HolderFormBody),
  { ssr: false, loading },
);

/** Warm the two heavy bodies the common paths open into (manual entry, import) so the
 *  first open doesn't wait on the network. Safe to call repeatedly (module cache). */
export function preloadAddMenuBodies(): void {
  void loadNewEntryTabs();
  void loadImportFlow();
}
