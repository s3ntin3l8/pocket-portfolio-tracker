"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useRegisterPageCommands } from "@/components/page-commands";
import { DEFAULT_HERO_RANGE, HERO_RANGES, RANGE_PARAM } from "@/lib/chart-range";

/** Command-bar entries for Holdings: the hero chart range. A server-visible `?range=`
 *  (replace, not push) — the hero adopts a new `initialRange` on re-render. */
export function HoldingsPageCommands() {
  const t = useTranslations("Search");
  const tRange = useTranslations("Chart.range");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  useRegisterPageCommands({
    id: "holdings-range",
    heading: t("groupRange"),
    items: HERO_RANGES.map((r) => ({
      id: r,
      label: t("rangeTo", { range: tRange(r) }),
      run: ({ navigate }) => {
        const params = new URLSearchParams(query);
        if (r === DEFAULT_HERO_RANGE) params.delete(RANGE_PARAM);
        else params.set(RANGE_PARAM, r);
        const qs = params.toString();
        navigate(qs ? `${pathname}?${qs}` : pathname, { replace: true });
      },
    })),
  });
  return null;
}
