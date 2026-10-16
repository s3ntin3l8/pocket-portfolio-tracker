"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScopeLink } from "@/components/scope-link";
import { useIsShellIndex } from "@/components/section-heading-context";

/**
 * Section title used by every Settings/Admin sub-route's content. On mobile it's a
 * back-arrow + title row (the rail is hidden there, so this is the only way back to the
 * section's landing menu). On desktop the topbar owns the visible title (via
 * `PageHeaderSetter`), so the back-link is hidden and the `<h1>` stays only as a
 * screen-reader-only heading — the page keeps exactly one `<h1>` at every width (at the
 * shell's index the shell's own `title` is that `<h1>` and this renders as an `<h2>`). Shared
 * by `/settings/*` and `/admin/*` (see `SettingsShell`) so every section reads
 * consistently regardless of which tree it's in. Both trees include `PageHeaderSetter`
 * so the desktop topbar always has a title.
 */
export function SectionHeader({ title, backHref }: { title: string; backHref: string }) {
  const t = useTranslations("A11y");
  const isShellIndex = useIsShellIndex();
  const Heading = isShellIndex ? "h2" : "h1";
  return (
    <div className="mb-4 md:mb-0">
      <div className="flex items-center gap-3">
        <ScopeLink
          href={backHref}
          aria-label={t("back")}
          className="relative flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-sm before:absolute before:-inset-1 md:hidden"
        >
          <ChevronLeft className="size-[18px]" />
        </ScopeLink>
        <Heading className="text-xl font-bold tracking-tight md:sr-only">{title}</Heading>
      </div>
    </div>
  );
}
