import { BackLink } from "@/components/back-button";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  LineChart,
  Eye,
  MessageSquare,
  ArrowDownUp,
  HardDrive,
  Database,
  Clock,
  Users,
} from "lucide-react";
import { SettingsShell, type ShellNavItem } from "@/components/settings-shell";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin } from "@/lib/server-api";
import { tint } from "@/lib/tint";

/**
 * Shared master-detail layout for every `/admin/*` route — the same `SettingsShell`
 * pattern as `/settings/*`. Desktop rail links to the 6 real admin sub-routes with a
 * "‹ Profile" exit above the list; mobile shows the grouped landing menu at the bare
 * `/admin` index, or the section's own content (with its own `SectionHeader` back-link)
 * on any sub-route. The admin gate lives here (DRY) — each sub-page also re-checks
 * via `requireAdmin()` as a belt-and-suspenders guard. A failed `me` lookup renders
 * `<AdminGateFailure>` (DataState + retry), never a 404; only a successful non-admin
 * answer is `notFound()`.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const navItems: ShellNavItem[] = [
    {
      key: "providers",
      href: "/admin/providers",
      icon: <LineChart />,
      title: t("providers"),
      subtitle: t("providersHint"),
      ...tint("primary"),
    },
    {
      key: "vision",
      href: "/admin/vision",
      icon: <Eye />,
      title: t("visionProviders"),
      subtitle: t("visionProvidersHint"),
      ...tint("violet"),
    },
    {
      key: "assistant",
      href: "/admin/assistant",
      icon: <MessageSquare />,
      title: t("chatProviders"),
      subtitle: t("chatProvidersHint"),
      ...tint("primary"),
    },
    {
      key: "imports",
      href: "/admin/imports",
      icon: <ArrowDownUp />,
      title: t("importStrategy"),
      subtitle: t("importStrategyHint"),
      ...tint("teal"),
    },
    {
      key: "storage",
      href: "/admin/storage",
      icon: <HardDrive />,
      title: t("storage"),
      subtitle: t("storageHint"),
      ...tint("info"),
    },
    {
      key: "database",
      href: "/admin/database",
      icon: <Database />,
      title: t("stats"),
      subtitle: t("statsHint"),
      ...tint("gold"),
    },
    {
      key: "users",
      href: "/admin/users",
      icon: <Users />,
      title: t("users"),
      subtitle: t("usersHint"),
      ...tint("warning"),
    },
    {
      key: "jobs",
      href: "/admin/jobs",
      icon: <Clock />,
      title: t("jobs"),
      subtitle: t("jobsHint"),
      ...tint("destructive"),
    },
  ];

  return (
    <SettingsShell
      navItems={navItems}
      indexHref="/admin"
      title={t("title")}
      landingTop={
        <div className="mb-4 flex items-center gap-3">
          <BackLink href="/settings" className="flex" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-heading font-semibold">{t("title")}</p>
            <p className="truncate text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
      }
    >
      {children}
    </SettingsShell>
  );
}
