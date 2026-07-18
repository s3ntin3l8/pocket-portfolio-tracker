"use client";

import { ChevronRight, Check, Pencil, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { CorporateAction } from "@portfolio/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useCorporateActions } from "./corporate-actions/use-corporate-actions";
import { CaSheetContent } from "./corporate-actions/ca-sheet-content";

export function CorporateActionsManager({
  items: initial,
  isAdmin = false,
}: {
  items: CorporateAction[];
  isAdmin?: boolean;
}) {
  const ca = useCorporateActions({ items: initial, isAdmin });

  if (ca.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{ca.t("noCorporateActions")}</p>;
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead
                colKey="type"
                sortKey={ca.sortKey}
                sortDir={ca.sortDir}
                onToggle={ca.toggleSort}
              >
                {ca.tc("type")}
              </SortableTableHead>
              <SortableTableHead
                colKey="ratio"
                sortKey={ca.sortKey}
                sortDir={ca.sortDir}
                onToggle={ca.toggleSort}
              >
                {ca.tc("ratio")}
              </SortableTableHead>
              <SortableTableHead
                colKey="exDate"
                sortKey={ca.sortKey}
                sortDir={ca.sortDir}
                onToggle={ca.toggleSort}
              >
                {ca.tc("exDate")}
              </SortableTableHead>
              {ca.isAdmin && (
                <TableCell className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                  <span className="sr-only">{ca.tc("edit")}</span>
                </TableCell>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ca.sorted.map((c: CorporateAction) =>
              ca.editingId === c.id ? (
                <TableRow key={c.id}>
                  <TableCell colSpan={ca.isAdmin ? 4 : 3}>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">{ca.tc("type")}</span>
                        <Select
                          aria-label={ca.tc("type")}
                          value={ca.type}
                          onChange={(e) =>
                            ca.setType(e.target.value as "split" | "bonus" | "rights")
                          }
                        >
                          {ca.TYPES.map((ty: string) => (
                            <option key={ty} value={ty}>
                              {ca.tt(ty)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">{ca.tc("ratio")}</span>
                        <Input
                          aria-label={ca.tc("ratio")}
                          inputMode="decimal"
                          className="w-24"
                          value={ca.ratio}
                          onChange={(e) => ca.setRatio(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">{ca.tc("exDate")}</span>
                        <DatePicker
                          label={ca.tc("exDate")}
                          className="w-40"
                          value={ca.exDate}
                          onChange={(e) => ca.setExDate(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={ca.tc("save")}
                          disabled={ca.busy}
                          onClick={() => ca.save(c.id)}
                        >
                          {ca.busy ? <Spinner size="sm" /> : <Check className="size-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={ca.tc("cancel")}
                          disabled={ca.busy}
                          onClick={() => ca.setEditingId(null)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={c.id}>
                  <TableCell>
                    <Badge variant="outline">{ca.tt(c.type)}</Badge>
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">{c.ratio}</TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    {ca.df.format(new Date(c.exDate))}
                  </TableCell>
                  {ca.isAdmin && (
                    <TableCell className="text-right">
                      {ca.confirmId === c.id ? (
                        <span className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={ca.busy}
                            onClick={() => ca.remove(c.id)}
                          >
                            {ca.busy && <Spinner size="xs" />}
                            {ca.tc("delete")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={ca.busy}
                            onClick={() => ca.setConfirmId(null)}
                          >
                            {ca.tc("cancel")}
                          </Button>
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={ca.tc("edit")}
                            onClick={() => ca.beginEdit(c)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={ca.tc("delete")}
                            onClick={() => {
                              ca.setEditingId(null);
                              ca.setConfirmId(c.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {ca.sorted.map((c: CorporateAction) => (
          <div
            key={c.id}
            {...(ca.isAdmin
              ? {
                  role: "button" as const,
                  tabIndex: 0,
                  className:
                    "flex cursor-pointer items-center justify-between rounded-[20px] bg-card shadow-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  onClick: () => ca.openSheet(c),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      ca.openSheet(c);
                    }
                  },
                }
              : {
                  className:
                    "flex items-center justify-between rounded-[20px] bg-card shadow-card px-4 py-3",
                })}
          >
            <div>
              <Badge variant="outline">{ca.tt(c.type)}</Badge>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {c.ratio} · {ca.df.format(new Date(c.exDate))}
              </div>
            </div>
            {ca.isAdmin && <ChevronRight className="size-5 shrink-0 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {ca.isAdmin && (
        <Sheet
          open={ca.sheetCa !== null}
          onOpenChange={(o) => {
            if (!o) ca.closeSheet();
          }}
        >
          <CaSheetContent
            ca={ca.sheetCa}
            type={ca.type}
            onTypeChange={(v) => ca.setType(v as "split" | "bonus" | "rights")}
            ratio={ca.ratio}
            onRatioChange={ca.setRatio}
            exDate={ca.exDate}
            onExDateChange={ca.setExDate}
            busy={ca.busy}
            confirmDelete={ca.confirmDelete}
            onConfirmDeleteChange={ca.setConfirmDelete}
            onClose={ca.closeSheet}
            onSave={ca.save}
            onDelete={ca.remove}
            TYPES={ca.TYPES}
            tc={ca.tc}
            tt={ca.tt}
          />
        </Sheet>
      )}
    </>
  );
}
