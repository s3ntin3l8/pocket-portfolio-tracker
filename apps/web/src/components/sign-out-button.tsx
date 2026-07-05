"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

/**
 * Signs the user out and returns to the landing page. Rendered as the reference's
 * full-width red "Sign out" card (card surface, destructive-red icon + label).
 */
export function SignOutButton() {
  const t = useTranslations("Settings");
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-card py-3.5 text-sm font-bold text-destructive shadow-card transition-colors hover:bg-destructive/5"
    >
      <LogOut className="size-4" />
      {t("signOut")}
    </button>
  );
}
