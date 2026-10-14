"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiErrorCode } from "@portfolio/api-client";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Per-installment ⋯ menu: skip an unpaid installment, or restore a skipped one. */
export function GoldInstallmentMenu({
  portfolioId,
  loanId,
  n,
  skipped,
}: {
  portfolioId: string;
  loanId: string;
  n: number;
  skipped: boolean;
}) {
  const t = useTranslations("GoldReport");
  const tA = useTranslations("A11y");
  const router = useRouter();
  const api = useApiClient();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      if (skipped) await api.unskipInstallment(portfolioId, loanId, n);
      else await api.skipInstallment(portfolioId, loanId, n);
      toast.success(skipped ? t("unskipped") : t("skipped"));
      router.refresh();
    } catch (err) {
      const code = apiErrorCode(err);
      toast.error(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={tA("moreOptions")} disabled={busy}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void toggle()}>
          {skipped ? t("unskipAction") : t("skipAction")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
