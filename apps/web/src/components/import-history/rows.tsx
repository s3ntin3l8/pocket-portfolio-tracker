"use client";

import { InfoTip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";
import { Download, Eye, FolderInput, Trash2, Undo2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import type { ImportRecord } from "@portfolio/api-client";
import { cn } from "@/lib/utils";
import { onActivateKey } from "@/lib/a11y";
import { sourceMeta, statusLabelKey } from "./utils";
import { STATUS_VARIANT } from "./types";
import { Checkbox } from "@/components/ui/checkbox";

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function RowActions({
  imp,
  busyId,
  confirmId,
  canReassign,
  t,
  onDiscard,
  onClear,
  onUndo,
  onDownload,
  onReassign,
  onSetConfirmId,
}: {
  imp: ImportRecord;
  busyId: string | null;
  confirmId: string | null;
  canReassign: boolean;
  t: (key: string, params?: Record<string, string | number | Date>) => string;
  onDiscard: (id: string) => void;
  onClear: (id: string) => void;
  onUndo: (id: string) => void;
  onDownload: (id: string) => void;
  onReassign: (id: string) => void;
  onSetConfirmId: (id: string | null) => void;
}) {
  const busy = busyId === imp.id;

  return (
    <span className="flex items-center justify-end gap-1">
      {imp.status === "draft" && (
        <>
          <InfoTip label={t("review")}>
            <Button size="icon" variant="ghost" asChild>
              <Link
                href={`/transactions/import/${imp.id}`}
                aria-label={t("review")}
                onPointerDown={stop}
                onClick={stop}
              >
                <Eye className="size-4" />
              </Link>
            </Button>
          </InfoTip>
          <InfoTip label={t("discard")}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("discard")}
              disabled={busy}
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                onDiscard(imp.id);
              }}
            >
              {busy ? <Spinner size="sm" /> : <Trash2 className="size-4" />}
            </Button>
          </InfoTip>
        </>
      )}
      {imp.status === "discarded" && (
        <InfoTip label={t("clear")}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("clear")}
            disabled={busy}
            onPointerDown={stop}
            onClick={(e) => {
              stop(e);
              onClear(imp.id);
            }}
          >
            {busy ? <Spinner size="sm" /> : <Trash2 className="size-4" />}
          </Button>
        </InfoTip>
      )}
      {imp.status === "confirmed" &&
        (confirmId === imp.id ? (
          <>
            <span className="text-xs text-muted-foreground">
              {t("undoWarning", { count: imp.count })}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                onUndo(imp.id);
              }}
            >
              {busy && <Spinner size="xs" />}
              {t("undo")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                onSetConfirmId(null);
              }}
            >
              {t("cancel")}
            </Button>
          </>
        ) : (
          <>
            {imp.document && (
              <InfoTip label={imp.document.originalFilename ?? t("downloadReceipt")}>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("downloadReceipt")}
                  onPointerDown={stop}
                  onClick={(e) => {
                    stop(e);
                    onDownload(imp.id);
                  }}
                >
                  <Download className="size-4" />
                </Button>
              </InfoTip>
            )}
            {canReassign && (
              <InfoTip label={t("reassign")}>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("reassign")}
                  onPointerDown={stop}
                  onClick={(e) => {
                    stop(e);
                    onReassign(imp.id);
                  }}
                >
                  <FolderInput className="size-4" />
                </Button>
              </InfoTip>
            )}
            <InfoTip label={t("undo")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("undo")}
                onPointerDown={stop}
                onClick={(e) => {
                  stop(e);
                  onSetConfirmId(imp.id);
                }}
              >
                <Undo2 className="size-4" />
              </Button>
            </InfoTip>
          </>
        ))}
    </span>
  );
}

export function DesktopRow({
  imp,
  selected,
  selectionMode,
  t,
  ts,
  df,
  onToggleOne,
  actions,
}: {
  imp: ImportRecord;
  selected: Set<string>;
  selectionMode: boolean;
  t: (key: string, params?: Record<string, string | number | Date>) => string;
  ts: (key: string) => string;
  df: Intl.DateTimeFormat;
  onToggleOne: (id: string) => void;
  actions: React.ReactNode;
}) {
  const { style, label } = sourceMeta(imp, ts);
  const Icon = style.icon;
  return (
    <TableRow data-state={selected.has(imp.id) ? "selected" : undefined}>
      <TableCell className="w-16">
        {selectionMode && (
          <Checkbox
            className="size-4"
            aria-label={t("selectRow")}
            checked={selected.has(imp.id)}
            onCheckedChange={() => onToggleOne(imp.id)}
          />
        )}
      </TableCell>
      <TableCell className="max-w-[220px]">
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-sm"
            style={{ background: style.bg, color: style.fg }}
          >
            <Icon className="size-3.5" strokeWidth={2} />
          </span>
          <span className="min-w-0 truncate text-body-sm font-bold" title={label}>
            {label}
          </span>
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="uppercase">
          {imp.parser}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[imp.status]}>{t(statusLabelKey(imp))}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{t("items", { count: imp.count })}</TableCell>
      <TableCell
        className="tabular whitespace-nowrap text-muted-foreground"
        suppressHydrationWarning
      >
        {df.format(new Date(imp.createdAt))}
      </TableCell>
      <TableCell className="text-right">{actions}</TableCell>
    </TableRow>
  );
}

export function MobileRow({
  imp,
  selected,
  selectionMode,
  t,
  ts,
  shortDf,
  onToggleOne,
  longPressHandlers,
  consumeLongPress,
  actions,
}: {
  imp: ImportRecord;
  selected: Set<string>;
  selectionMode: boolean;
  t: (key: string, params?: Record<string, string | number | Date>) => string;
  ts: (key: string) => string;
  shortDf: Intl.DateTimeFormat;
  onToggleOne: (id: string) => void;
  longPressHandlers: (id: string) => Record<string, (e: React.PointerEvent) => void>;
  consumeLongPress: () => boolean;
  actions: React.ReactNode;
}) {
  const router = useRouter();
  const { style, sourceLabel, label } = sourceMeta(imp, ts);
  const Icon = style.icon;
  const isSelected = selected.has(imp.id);

  function handleTap() {
    if (consumeLongPress()) return;
    if (selectionMode) {
      onToggleOne(imp.id);
      return;
    }
    if (imp.status === "draft") {
      router.push(`/transactions/import/${imp.id}`);
    }
  }

  return (
    <div
      data-testid={`import-mobile-${imp.id}`}
      data-state={isSelected ? "selected" : undefined}
      role="button"
      tabIndex={0}
      onClick={handleTap}
      onKeyDown={onActivateKey(handleTap)}
      {...longPressHandlers(imp.id)}
      className={cn(
        "flex cursor-pointer select-none items-center gap-3 px-[15px] py-[13px]",
        isSelected && "bg-primary/10",
      )}
    >
      {selectionMode && (
        <Checkbox
          tabIndex={-1}
          aria-label={t("selectRow")}
          checked={isSelected}
          className="pointer-events-none size-4 shrink-0"
        />
      )}
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-md"
        style={{ background: style.bg, color: style.fg }}
      >
        <Icon className="size-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-bold" title={label}>
          {label}
        </p>
        <div className="flex min-w-0 items-center gap-1.5 text-micro font-medium text-text-2">
          <span className="truncate">
            {sourceLabel} · {shortDf.format(new Date(imp.createdAt))} ·{" "}
            {t("items", { count: imp.count })}
          </span>
          <Badge variant={STATUS_VARIANT[imp.status]} className="shrink-0 px-1.5 py-0 text-micro">
            {t(statusLabelKey(imp))}
          </Badge>
        </div>
      </div>
      <span className="shrink-0">{actions}</span>
    </div>
  );
}
