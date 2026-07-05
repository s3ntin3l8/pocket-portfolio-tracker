"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, PenLine, FileUp, GitBranch, GitMerge, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ImportFlowClient } from "@/components/import-flow-client";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import type { ImportTargetPortfolio } from "@/components/import-flow";

/**
 * The unified add-entry menu (Manual / Import / Corporate action). Rendered globally in
 * the app-shell header (so it's reachable from every screen) and also inline in some
 * empty states.
 *
 * `autoOpenFromParams` must be set on exactly ONE rendered instance per page — the global
 * shell instance. It owns the `?shared=1` / `?import=1` auto-open (PWA share-target and
 * shortcut). If two instances auto-opened, their `ImportFlowClient` mounts would race to
 * consume and clear the cached screenshot, so every inline instance leaves it `false`.
 */
export function AddTransactionMenu({
  autoOpenFromParams = false,
}: {
  autoOpenFromParams?: boolean;
} = {}) {
  const tm = useTranslations("Manage");
  const ti = useTranslations("Import");
  const api = useApiClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [portfolios, setPortfolios] = useState<ImportTargetPortfolio[] | null>(null);
  const [defaultPortfolioId, setDefaultPortfolioId] = useState("");

  // A screenshot shared into the app lands on /transactions?shared=1 (see sw.ts); the
  // "Import screenshot" PWA shortcut lands on ?import=1. Either auto-opens the import sheet
  // — but only on the single instance that owns this (see the prop doc above).
  useEffect(() => {
    if (!autoOpenFromParams) return;
    const shared = searchParams.get("shared") === "1";
    const importFlag = searchParams.get("import") === "1";
    if (shared || importFlag) void openImport();
    // `shared` is consumed + cleared by ImportFlowClient once it mounts (it needs the
    // param to fetch the cached image first); clear the bare `import` flag here so a
    // refresh doesn't re-open the sheet.
    if (importFlag && !shared) router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openImport() {
    if (portfolios === null) {
      const fetched = await api.listPortfolios();
      const mapped = fetched.map((p) => ({
        id: p.id,
        name: p.name,
        brokerage: p.brokerage,
        accountHolder: p.accountHolder,
      }));
      setPortfolios(mapped);
      setDefaultPortfolioId(mapped[0]?.id ?? "");
    }
    setAddOpen(false);
    setImportOpen(true);
  }

  return (
    <>
      <Button aria-label={tm("addTransaction")} onClick={() => setAddOpen(true)}>
        <Plus className="size-4" />
        <span className="hidden sm:inline">{tm("addMenu.add")}</span>
      </Button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold">{tm("addMenu.title")}</DialogTitle>
            <DialogDescription>{tm("addMenu.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5">
            <AddMenuCard
              icon={FileUp}
              title={tm("addMenu.import")}
              description={tm("addMenu.importDesc")}
              tone="success"
              tag={tm("addMenu.recommended")}
              onClick={() => void openImport()}
            />
            <AddMenuCard
              icon={PenLine}
              title={tm("addMenu.manual")}
              description={tm("addMenu.manualDesc")}
              tone="warning"
              href="/transactions/new"
              onNavigate={() => setAddOpen(false)}
            />
            <AddMenuCard
              icon={GitBranch}
              title={tm("addMenu.corpAction")}
              description={tm("addMenu.corpActionDesc")}
              tone="violet"
              href={{ pathname: "/transactions/new", query: { kind: "corporate-action" } }}
              onNavigate={() => setAddOpen(false)}
            />
            <AddMenuCard
              icon={GitMerge}
              title={tm("addMenu.merger")}
              description={tm("addMenu.mergerDesc")}
              tone="teal"
              href={{ pathname: "/transactions/new", query: { kind: "merger" } }}
              onNavigate={() => setAddOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent
          className="p-0"
          side="bottom"
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="px-6 pt-6">
            <SheetTitle>{ti("title")}</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto px-6 pb-6 pt-4">
            {portfolios && (
              <ImportFlowClient
                portfolios={portfolios}
                defaultPortfolioId={defaultPortfolioId}
                onClose={() => setImportOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const TONE_CLASSES = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  violet: "bg-[#7C5CFC]/15 text-[#7C5CFC]",
  teal: "bg-[#0D9488]/15 text-[#0D9488]",
} as const;

/** One row in the "Add to portfolio" launcher (`Pocket Prototype.dc.html`'s
 *  `methodCards`): icon chip + title + description, optionally a tag pill and/or a
 *  navigation href. Renders as a `Link` when `href` is given, else a plain button. */
function AddMenuCard({
  icon: Icon,
  title,
  description,
  tone,
  tag,
  href,
  onClick,
  onNavigate,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  tone: keyof typeof TONE_CLASSES;
  tag?: string;
  href?: ComponentProps<typeof Link>["href"];
  onClick?: () => void;
  onNavigate?: () => void;
}) {
  const content = (
    <>
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONE_CLASSES[tone]}`}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold">{title}</span>
          {tag && (
            <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
              {tag}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </>
  );
  const className =
    "flex items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/50";

  if (href) {
    return (
      <Link href={href} className={className} onClick={onNavigate}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}
