import { getTranslations } from "next-intl/server";
import type { AdminUser } from "@portfolio/api-client";
import { AdminUserActions } from "@/components/admin-user-actions";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[7px] bg-background px-[9px] py-1 text-[11px] font-semibold tabular-nums text-text-2">
      {children}
    </span>
  );
}

/**
 * Design (`Admin Settings.dc.html`, USERS section): one card-row list — the same shape
 * at every breakpoint, replacing the old desktop `<table>` / mobile-card split. Each row:
 * email + join date + kebab on one line, name below, then a wrapped row of stat pills.
 */
export async function AdminUsersTable({ users }: { users: AdminUser[] }) {
  const t = await getTranslations("Admin");

  if (users.length === 0) {
    return <p className="text-sm italic text-muted-foreground">{t("usersNoUsers")}</p>;
  }

  return (
    <div className="overflow-hidden rounded-[20px] bg-card shadow-card">
      {users.map((u, i) => (
        <div key={u.id} className={i > 0 ? "border-t border-line px-4 py-3.5" : "px-4 py-3.5"}>
          <div className="flex items-baseline gap-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{u.email}</span>
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-text-3">
              {new Date(u.createdAt).toLocaleDateString()}
            </span>
            <AdminUserActions
              userId={u.id}
              email={u.email}
              onboardingCompleted={u.onboardingCompletedAt !== null}
            />
          </div>
          <div className="mt-0.5 text-xs font-medium text-text-2">{u.name ?? "—"}</div>
          <div className="mt-2.5 flex flex-wrap gap-[5px]">
            <Pill>
              {u.portfolioCount} {t("usersPortfolios")}
            </Pill>
            <Pill>
              {u.transactionCount} {t("usersTransactions")}
            </Pill>
            <Pill>
              {u.documentCount} {t("usersDocuments")}
            </Pill>
            <Pill>{formatBytes(u.storageBytes)}</Pill>
            <Pill>
              {u.tokenCount} {t("usersTokens")}
            </Pill>
          </div>
        </div>
      ))}
    </div>
  );
}
