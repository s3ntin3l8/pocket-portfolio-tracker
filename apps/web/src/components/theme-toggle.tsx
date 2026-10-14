"use client";

import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeMode } from "@/lib/use-theme-mode";

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("A11y");
  const { isDark, toggle } = useThemeMode();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("toggleTheme")}
      onClick={toggle}
      className={className}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
