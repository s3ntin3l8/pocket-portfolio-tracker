"use client";

import { toast } from "sonner";
import { classifyImportError, importErrorDetail } from "@/lib/import-errors";
import type { GroupMap } from "../types";

/** The `Import` translator, narrowed to what the flow needs. `has` is next-intl's "does this
 *  key exist" check — optional, so a plain function still satisfies the type. */
type TFunction = ((key: string, params?: Record<string, string | number>) => string) & {
  has?: (key: string) => boolean;
};

export function errorMessage(err: unknown, t: TFunction): string {
  const info = classifyImportError(err);
  const detail = info.reason === "generic" ? importErrorDetail(info) : null;
  if (detail) return t("errors.genericDetailed", { detail });
  // The reason is dynamic: an unknown one falls back to the generic error, never to the
  // key path.
  const key = `errors.${info.reason}`;
  const params = { provider: info.provider ?? "" };
  return t.has && !t.has(key) ? t("errors.generic") : t(key, params);
}

export function taskLabel(groups: GroupMap, t: TFunction): string {
  const names = Array.from(groups.values());
  if (names.length === 1) return names[0] ?? "";
  return t("toast.filesLabel", { count: names.length });
}

export function notifyMaterialized(
  count: number,
  router: { refresh: () => void; push: (href: string) => void },
  t: TFunction,
) {
  router.refresh();
  toast.success(t("toast.success", { count }), {
    action: {
      label: t("toast.viewTransactions"),
      onClick: () => router.push("/transactions"),
    },
  });
}
