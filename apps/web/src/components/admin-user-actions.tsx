"use client";

import { useState } from "react";
import { History, MoreVertical, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/**
 * Design (`Admin Settings.dc.html`, USERS section): a single `⋮` kebab per user row
 * opening a `min-width:186px` menu (Revoke tokens / Reset onboarding / Delete user, red) —
 * replacing the three always-visible inline buttons. Each item still opens the same
 * `ConfirmActionDialog` flow as before, now in its *controlled* mode (see that
 * component's doc comment) since nesting a `DialogTrigger` inside a `DropdownMenuItem`
 * fights Radix's own focus/dismiss handling — the dropdown itself stays uncontrolled.
 */
export function AdminUserActions({
  userId,
  email,
  onboardingCompleted = false,
}: {
  userId: string;
  email: string;
  /** Only offer the reset when onboarding has actually been completed/skipped. Defaults
   *  to false (hiding the option) — every real caller passes it explicitly; this default
   *  only matters for a hypothetical future caller that omits it, and hiding is the
   *  safer failure mode than exposing a reset action that shouldn't be offered yet. */
  onboardingCompleted?: boolean;
}) {
  const t = useTranslations("Admin");
  const router = useRouter();
  const api = useApiClient();

  const [revokeOpen, setRevokeOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Left uncontrolled — Radix closes the menu on select by default. `preventDefault`
  // here only stops it from returning focus to the trigger afterward, which would
  // otherwise fight the confirm dialog's own focus trap when it opens right after.
  function selectItem(open: (v: boolean) => void) {
    return (e: Event) => {
      e.preventDefault();
      open(true);
    };
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("usersActions")}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-background hover:text-text-2"
          >
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[186px] rounded-[13px] p-0">
          <DropdownMenuItem
            onSelect={selectItem(setRevokeOpen)}
            className="gap-2.5 rounded-none px-3.5 py-3 text-[13px] font-semibold"
          >
            <History className="size-[15px]" />
            {t("revokeTokens")}
          </DropdownMenuItem>
          {onboardingCompleted && (
            <DropdownMenuItem
              onSelect={selectItem(setResetOpen)}
              className="gap-2.5 rounded-none border-t border-line px-3.5 py-3 text-[13px] font-semibold"
            >
              <RotateCw className="size-[15px]" />
              {t("resetOnboarding")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={selectItem(setDeleteOpen)}
            className="gap-2.5 rounded-none border-t border-line px-3.5 py-3 text-[13px] font-semibold text-destructive focus:text-destructive"
          >
            <Trash2 className="size-[15px]" />
            {t("deleteUser")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t("revokeTokens")}
        description={t("revokeTokensConfirm", { email })}
        entityLabel={email}
        confirmLabel={t("revokeTokens")}
        confirmVariant="default"
        requiresTyping={false}
        onConfirm={async () => {
          const { revoked } = await api.adminRevokeUserTokens(userId);
          toast.success(t("revokeTokensDone", { count: revoked }));
          router.refresh();
        }}
      />
      <ConfirmActionDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("resetOnboarding")}
        description={t("resetOnboardingConfirm", { email })}
        entityLabel={email}
        confirmLabel={t("resetOnboarding")}
        confirmVariant="default"
        requiresTyping={false}
        onConfirm={async () => {
          await api.adminResetUserOnboarding(userId);
          toast.success(t("resetOnboardingDone"));
          router.refresh();
        }}
      />
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteUser")}
        description={t("deleteUserConfirm", { email })}
        entityLabel={email}
        confirmLabel={t("deleteUser")}
        confirmVariant="destructive"
        requiresTyping={true}
        onConfirm={async () => {
          await api.adminDeleteUser(userId);
          toast.success(t("deleteUserDone"));
          router.refresh();
        }}
      />
    </>
  );
}
