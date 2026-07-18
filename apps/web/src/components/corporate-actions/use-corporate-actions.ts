"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { CorporateAction } from "@portfolio/api-client";
import { apiErrorCode } from "@portfolio/api-client";
import { toast } from "sonner";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { useTableSort } from "@/lib/table-sort";
import type { ColDef } from "@/lib/table-sort";

const CA_COLS: ColDef<CorporateAction>[] = [
  { key: "type", get: (ca) => ca.type, type: "text" },
  { key: "ratio", get: (ca) => ca.ratio, type: "numeric" },
  { key: "exDate", get: (ca) => ca.exDate, type: "date" },
];

const TYPES = ["split", "bonus", "rights"] as const;

export interface CorporateActionsProps {
  items: CorporateAction[];
  isAdmin?: boolean;
}

export function useCorporateActions({ items: initial, isAdmin = false }: CorporateActionsProps) {
  const t = useTranslations("Instrument");
  const tc = useTranslations("CorpAction");
  const tt = useTranslations("TxType");
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const api = useApiClient();
  const router = useRouter();

  const [items, setItems] = useState(initial);
  const { sortKey, sortDir, toggle: toggleSort, sort } = useTableSort<CorporateAction>(CA_COLS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>("split");
  const [ratio, setRatio] = useState("");
  const [exDate, setExDate] = useState("");
  const [sheetCa, setSheetCa] = useState<CorporateAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function beginEdit(ca: CorporateAction) {
    setConfirmId(null);
    setEditingId(ca.id);
    setType(ca.type as (typeof TYPES)[number]);
    setRatio(ca.ratio);
    setExDate(ca.exDate.slice(0, 10));
  }

  async function save(id: string) {
    setBusy(true);
    try {
      const updated = await api.updateCorporateAction(id, {
        type,
        ratio: ratio || "1",
        exDate: new Date(exDate),
      });
      setItems((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setEditingId(null);
      setSheetCa(null);
      router.refresh();
    } catch (err) {
      const code = apiErrorCode(err);
      if (code && tc.has(`errors.${code}`)) {
        toast.error(tc(`errors.${code}`));
      } else {
        toast.error(tc("saveError"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteCorporateAction(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
      router.refresh();
    } catch (err) {
      const code = apiErrorCode(err);
      if (code && tc.has(`errors.${code}`)) {
        toast.error(tc(`errors.${code}`));
      } else {
        toast.error(tc("deleteError"));
      }
    } finally {
      setBusy(false);
      setConfirmId(null);
      setSheetCa(null);
      setConfirmDelete(false);
    }
  }

  function openSheet(ca: CorporateAction) {
    setConfirmId(null);
    setEditingId(null);
    setType(ca.type as (typeof TYPES)[number]);
    setRatio(ca.ratio);
    setExDate(ca.exDate.slice(0, 10));
    setConfirmDelete(false);
    setSheetCa(ca);
  }

  function closeSheet() {
    setSheetCa(null);
    setConfirmDelete(false);
  }

  const sorted = sort(items);

  return {
    t,
    tc,
    tt,
    df,
    TYPES,
    isAdmin,
    items,
    sorted,
    editingId,
    setEditingId,
    confirmId,
    setConfirmId,
    busy,
    type,
    setType,
    ratio,
    setRatio,
    exDate,
    setExDate,
    sheetCa,
    confirmDelete,
    setConfirmDelete,
    sortKey,
    sortDir,
    toggleSort,
    beginEdit,
    save,
    remove,
    openSheet,
    closeSheet,
  };
}
