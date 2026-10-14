"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type CompactMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
};

/**
 * The connected state of a broker connection card, collapsed to one row: last sync time, a
 * primary Sync button and a ⋯ menu for the rarely-used actions. Anything bulky (reconcile
 * summary, scope note) goes in `details`, behind an expandable disclosure.
 */
export function ConnectedCompactRow({
  lastSyncAt,
  syncLabel,
  onSync,
  busy,
  menuItems,
  details,
}: {
  lastSyncAt: string | null;
  /** The broker's own "Sync now" label. */
  syncLabel: string;
  onSync: () => void;
  busy: boolean;
  menuItems: CompactMenuItem[];
  details?: ReactNode;
}) {
  const t = useTranslations("BrokerConnection");
  const tA = useTranslations("A11y");
  const locale = useLocale();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("lastSync")}: {lastSyncAt ? new Date(lastSyncAt).toLocaleString(locale) : t("never")}
        </p>
        <div className="flex items-center gap-1">
          <Button onClick={onSync} disabled={busy}>
            {busy ? <Spinner size="sm" /> : <RefreshCw className="size-4" />}
            {syncLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={tA("moreOptions")} disabled={busy}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menuItems.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onSelect={item.onSelect}
                  className={item.destructive ? "text-destructive focus:text-destructive" : ""}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {details && (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("details")}</summary>
          <div className="mt-2 space-y-3">{details}</div>
        </details>
      )}
    </div>
  );
}
