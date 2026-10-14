import { authViaKey } from "@/lib/auth-label";
import { isDevAuthBypass } from "@/lib/dev-auth";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { UserRound, TrendingUp, Briefcase, KeyRound, ShieldCheck } from "lucide-react";
import { SettingsShell, type ShellNavItem } from "@/components/settings-shell";
import { SettingsInstallItem } from "@/components/settings-install-item";
import { SignOutButton } from "@/components/sign-out-button";
import { AppVersion } from "@/components/app-version";
import { Link } from "@/i18n/navigation";
import { loadMe, loadPortfoliosList, loadAccountHolders } from "@/lib/server-api";
import { APP_VERSION } from "@/lib/version";
import { tint } from "@/lib/tint";

/**
 * Shared master-detail layout for every `/settings/*` route: a persistent desktop rail
 * (identity card + section nav + sign-out) beside the section's own content, or — at the
 * bare `/settings` index on mobile — a grouped landing menu instead. See
 * `SettingsShell` for the routing-based rail/landing mechanics shared with `/admin/*`.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const tNav = await getTranslations("Nav");

  // `me` only decides whether the Admin row shows: a failed lookup hides it (never a 404;
  // the admin pages themselves render a retryable DataState via `requireAdmin`).
  const [me, portfoliosResult, holders] = await Promise.all([
    loadMe(),
    loadPortfoliosList(),
    loadAccountHolders(),
  ]);

  const navItems: ShellNavItem[] = [
    {
      key: "account",
      href: "/settings/account",
      icon: <UserRound />,
      title: t("navAccount"),
      subtitle: t("navAccountSub"),
      ...tint("primary"),
    },
    {
      key: "investing",
      href: "/settings/investing",
      icon: <TrendingUp />,
      title: t("navInvesting"),
      subtitle: t("navInvestingSub"),
      ...tint("teal"),
    },
    {
      key: "portfolios",
      href: "/settings/portfolios",
      icon: <Briefcase />,
      title: t("portfoliosLink"),
      subtitle: t("navPortfoliosCount", {
        portfolios: portfoliosResult.portfolios.length,
        holders: holders.length,
      }),
      ...tint("violet"),
    },
    {
      key: "data",
      href: "/settings/connections",
      icon: <KeyRound />,
      title: t("navData"),
      subtitle: t("navDataSub"),
      ...tint("gold"),
    },
  ];

  const groups = [
    [navItems[0], navItems[1]],
    [navItems[2], navItems[3]],
  ];

  if (me?.isAdmin) {
    navItems.push({
      key: "admin",
      href: "/admin",
      icon: <ShieldCheck />,
      title: t("adminLink"),
      subtitle: t("adminDesc"),
      ...tint("info"),
      badge: t("adminBadge"),
      hideFromRail: true,
    });
    groups.push([navItems[navItems.length - 1]]);
  }

  const initials = (me?.name?.trim() || me?.email || "").slice(0, 2).toUpperCase() || "?";

  const identityCard = me && (
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-foreground text-sm font-bold text-background">
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-body font-extrabold">{me.name || me.email}</p>
        <p className="truncate text-xs text-muted-foreground">{me.email}</p>
      </div>
    </div>
  );

  return (
    <SettingsShell
      navItems={navItems}
      groups={groups}
      indexHref="/settings"
      railTop={
        identityCard && (
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
            {identityCard}
          </div>
        )
      }
      railBottom={<SignOutButton />}
      railExtra={<SettingsInstallItem variant="rail" />}
      landingExtra={<SettingsInstallItem variant="landing" />}
      landingBottom={
        // Mobile has no desktop rail, so surface sign-out here — with the auth/identity
        // line directly above it (matches the desktop account section's footer note).
        <div className="space-y-2 pt-1">
          <p className="px-1 text-center text-xs text-muted-foreground">
            {t(authViaKey(me?.authSub, isDevAuthBypass()), { email: me?.email ?? "" })}
          </p>
          <SignOutButton />
          <AppVersion
            ariaLabel={t("version", { version: APP_VERSION })}
            className="block text-center text-xs text-muted-foreground"
          />
        </div>
      }
      title={tNav("settings")}
      landingTop={
        <>
          {identityCard && (
            <Link
              href="/settings/account"
              className="mb-4 flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:bg-muted/50"
            >
              {identityCard}
            </Link>
          )}
        </>
      }
    >
      {children}
    </SettingsShell>
  );
}
