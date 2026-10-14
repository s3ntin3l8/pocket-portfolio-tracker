"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ToggleRow } from "@/components/ui/toggle-row";
import { readShortcutsEnabled, writeShortcutsEnabled } from "@/lib/shortcut-preference";

/** Settings → Account: turn the single-key shortcuts off (stored in this browser only). */
export function ShortcutsToggle() {
  const t = useTranslations("Settings");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(readShortcutsEnabled());
  }, []);
  return (
    <ToggleRow
      id="shortcuts-enabled"
      label={t("shortcutsLabel")}
      hint={t("shortcutsHint")}
      checked={enabled}
      onCheckedChange={(v) => {
        setEnabled(v);
        writeShortcutsEnabled(v);
      }}
    />
  );
}
