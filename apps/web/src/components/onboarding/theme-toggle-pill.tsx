"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useThemeMode } from "@/lib/use-theme-mode";
import { Icon, ICONS } from "./icon";

type Mode = "light" | "dark";

const ITEM = "flex size-8 items-center justify-center rounded-full";

const TRACK = "gap-0.5 rounded-full border border-input bg-muted p-0.5";

function SunIcon() {
  // `ICONS.moonPath` is the ray set of the design's sun glyph — hence the circle.
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d={ICONS.moonPath} />
    </svg>
  );
}

/** The onboarding flow's compact light/dark switch (distinct from the app-wide
 *  `theme-toggle.tsx`), built on the shared `ToggleGroup` like the Settings switcher.
 *  Rendered both fixed-desktop and inline-mobile. */
export function ThemeTogglePill({ className }: { className?: string }) {
  const { mounted, isDark, setTheme } = useThemeMode();
  const t = useTranslations("Onboarding");

  // The theme is unknown on the server, so render an inert track with nothing active until
  // mounted — guessing would flash the wrong item on hydration.
  if (!mounted) {
    return (
      <div role="group" aria-label={t("themeLabel")} className={cn("flex", TRACK, className)}>
        <div className={cn(ITEM, "text-text-mute select-none")}>
          <SunIcon />
        </div>
        <div className={cn(ITEM, "text-text-mute select-none")}>
          <Icon d={ICONS.sun} size={15} />
        </div>
      </div>
    );
  }

  const value: Mode = isDark ? "dark" : "light";

  return (
    <ToggleGroup<Mode>
      value={value}
      onValueChange={setTheme}
      aria-label={t("themeLabel")}
      className={cn(TRACK, className)}
    >
      <ToggleGroupItem
        value="light"
        aria-label={t("themeLight")}
        className={cn(
          ITEM,
          value === "light" ? "bg-pill text-white" : "text-text-mute hover:text-foreground",
        )}
      >
        <SunIcon />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label={t("themeDark")}
        className={cn(
          ITEM,
          value === "dark" ? "bg-pill text-white" : "text-text-mute hover:text-foreground",
        )}
      >
        {/* `ICONS.sun` is the design's crescent path. */}
        <Icon d={ICONS.sun} size={15} />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
