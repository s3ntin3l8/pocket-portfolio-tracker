import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { DisplayCurrency } from "@/components/display-currency";
import { UpdateProfile } from "@/components/update-profile";
import { ChangePassword } from "@/components/change-password";
import { AppVersion } from "@/components/app-version";
import { APP_VERSION } from "@/lib/version";

/**
 * The Settings "Account" section content — reused verbatim by both `/settings` (the
 * index route's desktop default) and `/settings/account` (the mobile drill-in target).
 * Preferences are grouped into logical blocks with dividers — no individual Card boxes.
 */
export async function AccountSection({
  me,
  localAuthAvailable = false,
}: {
  me: { name: string | null; displayCurrency: string; email: string; authSub: string } | null;
  /** AUTH_LOCAL_SECRET is configured — gates the Password card. Not gated on whether
   *  *this* user already has a local password set (the API has no such flag on /me):
   *  an OIDC-only user submitting it gets changePasswordErrors.no_local_password_set. */
  localAuthAvailable?: boolean;
}) {
  const t = await getTranslations("Settings");

  return (
    <div className="space-y-6">
      {me && <UpdateProfile initialName={me.name ?? ""} />}

      <div>
        <p className="mb-2 px-0.5 text-xs font-bold uppercase tracking-[.04em] text-text-3">
          {t("displayCurrency")}
        </p>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
          <div className="p-4">
            <DisplayCurrency current={me?.displayCurrency ?? ""} />
          </div>
          <div className="p-4">
            <p className="mb-2 text-xs font-semibold text-text-2">{t("language")}</p>
            <LocaleSwitcher />
          </div>
          <div className="p-4">
            <p className="mb-2 text-xs font-semibold text-text-2">{t("appearance")}</p>
            <ThemeSwitcher />
          </div>
        </div>
      </div>

      {localAuthAvailable && me && (
        <div>
          <p className="mb-2 px-0.5 text-xs font-bold uppercase tracking-[.04em] text-text-3">
            {t("password")}
          </p>
          <div className="overflow-hidden rounded-2xl bg-card shadow-card">
            <div className="p-4">
              <ChangePassword email={me.email} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-xl bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
        <Lock className="size-4 shrink-0" />
        <span>
          {me?.authSub.startsWith("local|")
            ? t("authViaLocal", { email: me?.email ?? "" })
            : t("authVia", { email: me?.email ?? "" })}
        </span>
      </div>
      <AppVersion
        ariaLabel={t("version", { version: APP_VERSION })}
        className="block text-center text-xs text-muted-foreground"
      />
    </div>
  );
}
