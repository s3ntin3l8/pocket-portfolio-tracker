"use client";

import { useTranslations } from "next-intl";
import type { Portfolio } from "@portfolio/api-client";
import { Select } from "@/components/ui/select";
import { BrokerageIcon } from "@/components/brokerage-icon";
import { useRouter } from "@/i18n/navigation";
import { SELECTED_PORTFOLIO_COOKIE } from "@/lib/portfolio-selection";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Global portfolio scope selector shown in the app shell. The first option is the
 * "All portfolios" aggregate (the default); choosing one writes the `pf` cookie and
 * refreshes so the RSC screens (holdings, transactions, import) re-read the scope.
 * Hidden until the user actually has more than one portfolio to switch between.
 */
export function PortfolioSwitcher({
  portfolios,
  selectedId,
}: {
  portfolios: Pick<Portfolio, "id" | "name" | "brokerage">[];
  selectedId: string | null;
}) {
  const t = useTranslations("PortfolioSwitcher");
  const router = useRouter();

  if (portfolios.length < 2) return null;

  function onChange(value: string) {
    document.cookie = `${SELECTED_PORTFOLIO_COOKIE}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    router.refresh();
  }

  // Native <option>s can't render an icon, so the brokerage shows as text there; the
  // selected portfolio's logo is shown as a leading adornment next to the select.
  const selected = portfolios.find((p) => p.id === selectedId);

  return (
    <div className="flex items-center gap-2">
      {selected && <BrokerageIcon brokerage={selected.brokerage} className="size-7" />}
      <Select
        aria-label={t("label")}
        value={selectedId ?? "all"}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="all">{t("all")}</option>
        {portfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.brokerage ? `${p.name} · ${p.brokerage}` : p.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
