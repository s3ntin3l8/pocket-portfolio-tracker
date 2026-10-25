"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const LOCALES = ["en", "id"] as const;

/** Two-option pill pair — same visual pattern as `PreferenceChips` (Tax regime/cost-basis
 *  toggles), showing both languages at once rather than a single "tap to flip" button. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("Settings");

  return (
    <ToggleGroup
      value={locale}
      onValueChange={(l) => router.replace(pathname, { locale: l })}
      aria-label={t("language")}
      className="w-full gap-[7px]"
    >
      {LOCALES.map((l) => (
        <ToggleGroupItem
          key={l}
          value={l}
          className={cn(
            "flex-1 rounded-sm py-[9px] text-center text-body-sm",
            locale === l
              ? "bg-pill font-bold text-white"
              : "bg-background font-semibold text-foreground",
          )}
        >
          {t.has(`languageOptions.${l}`) ? t(`languageOptions.${l}`) : t("language")}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
