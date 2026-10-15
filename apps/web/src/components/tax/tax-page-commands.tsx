"use client";

import { useTranslations } from "next-intl";
import { Calendar } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useRegisterPageCommands } from "@/components/page-commands";
import { buildPeriodHref } from "@/components/period-select";

/** Command-bar entries for the Tax page: one per selectable tax year, writing the exact
 *  same `?year=` URL `PeriodSelect` does (the current year is the absent param). */
export function TaxPageCommands({
  years,
  selected,
  currentYear,
}: {
  years: readonly string[];
  selected: string;
  currentYear: string;
}) {
  const t = useTranslations("Search");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  useRegisterPageCommands({
    id: "tax-year",
    heading: t("groupPage"),
    items: years
      .filter((y) => y !== selected)
      .map((y) => ({
        id: y,
        label: t("taxYearTo", { year: y }),
        icon: Calendar,
        run: ({ navigate }) =>
          navigate(buildPeriodHref(pathname, query, "year", y, currentYear), { replace: true }),
      })),
  });
  return null;
}
