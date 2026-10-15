"use client";

import { useTranslations } from "next-intl";
import { Calculator } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useRegisterPageCommands } from "@/components/page-commands";

/** Command-bar entries for Trades: the same `?method=` switch as `TradeMethodToggle`. */
export function TradesPageCommands({ current }: { current: "average" | "fifo" }) {
  const t = useTranslations("Search");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  const href = (method: "average" | "fifo") => {
    const params = new URLSearchParams(query);
    params.set("method", method);
    return `${pathname}?${params.toString()}`;
  };

  useRegisterPageCommands({
    id: "trades-method",
    heading: t("groupPage"),
    items: (["fifo", "average"] as const)
      .filter((m) => m !== current)
      .map((m) => ({
        id: m,
        label: m === "fifo" ? t("methodFifo") : t("methodAverage"),
        icon: Calculator,
        run: ({ navigate }) => navigate(href(m), { replace: true }),
      })),
  });
  return null;
}
