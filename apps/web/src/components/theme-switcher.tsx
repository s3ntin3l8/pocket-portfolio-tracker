"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useThemeMode } from "@/lib/use-theme-mode";

const THEMES = ["light", "dark", "system"] as const;
type ThemeChoice = (typeof THEMES)[number];

function isThemeChoice(v: string | undefined): v is ThemeChoice {
  return THEMES.some((th) => th === v);
}

export function ThemeSwitcher() {
  const { theme, setTheme, mounted } = useThemeMode();
  const t = useTranslations("Settings");

  if (!mounted) {
    return (
      <div role="group" aria-label={t("appearance")} className="flex w-full gap-[7px]">
        {THEMES.map((th) => (
          <div
            key={th}
            className="flex-1 rounded-sm py-[9px] text-center text-body-sm bg-background font-semibold text-text-2 select-none"
          >
            {t.has(`appearanceOptions.${th}`) ? t(`appearanceOptions.${th}`) : t("appearance")}
          </div>
        ))}
      </div>
    );
  }

  return (
    <ToggleGroup<ThemeChoice>
      value={isThemeChoice(theme) ? theme : "system"}
      onValueChange={setTheme}
      aria-label={t("appearance")}
      className="w-full gap-[7px]"
    >
      {THEMES.map((th) => (
        <ToggleGroupItem
          key={th}
          value={th}
          className={cn(
            "flex-1 rounded-sm py-[9px] text-center text-body-sm",
            theme === th
              ? "bg-pill font-bold text-white"
              : "bg-background font-semibold text-foreground hover:bg-secondary",
          )}
        >
          {t.has(`appearanceOptions.${th}`) ? t(`appearanceOptions.${th}`) : t("appearance")}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
