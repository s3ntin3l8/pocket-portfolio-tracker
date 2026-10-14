"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COMMAND_PAGES } from "@/components/nav-items";

function Keys({ keys, then }: { keys: string[]; then: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-xs text-muted-foreground">{then}</span>}
          <kbd className="min-w-6 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/** The `?` help sheet: every single-key shortcut, grouped. Controlled by the command bar. */
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Search");
  const tNav = useTranslations("Nav");
  const then = t("shortcutThen");

  const general: { label: string; keys: string[] }[] = [
    { label: t("shortcutOpenSearch"), keys: ["⌘/Ctrl", "K"] },
    { label: t("shortcutOpenSearchSlash"), keys: ["/"] },
    { label: t("shortcutNewTransaction"), keys: ["n"] },
    { label: t("shortcutHelp"), keys: ["?"] },
  ];
  const goTo = COMMAND_PAGES.filter((p) => p.chord).map((p) => ({
    label: tNav(p.labelKey),
    keys: ["g", p.chord as string],
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" fullScreenOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{t("shortcutsTitle")}</DialogTitle>
          <DialogDescription>{t("shortcutsDescription")}</DialogDescription>
        </DialogHeader>
        {[
          { heading: t("shortcutsGroupGeneral"), rows: general },
          { heading: t("shortcutsGroupGoTo"), rows: goTo },
        ].map((group) => (
          <section key={group.heading} aria-label={group.heading} className="mt-2">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{group.heading}</h3>
            <ul className="divide-y divide-border">
              {group.rows.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-sm">{row.label}</span>
                  <Keys keys={row.keys} then={then} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
