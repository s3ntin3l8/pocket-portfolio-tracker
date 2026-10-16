"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { useId, useState } from "react";
import { History, MoreVertical, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
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
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-2 hover:bg-background hover:text-text-2"
          >
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[186px] rounded-md p-0">
          <DropdownMenuItem
            onSelect={selectItem(setRevokeOpen)}
            className="gap-2.5 rounded-none px-3.5 py-3 text-body-sm font-semibold"
          >
            <History className="size-[15px]" />
            {t("revokeTokens")}
          </DropdownMenuItem>
          {onboardingCompleted && (
            <DropdownMenuItem
              onSelect={selectItem(setResetOpen)}
              className="gap-2.5 rounded-none border-t border-line px-3.5 py-3 text-body-sm font-semibold"
            >
              <RotateCw className="size-[15px]" />
              {t("resetOnboarding")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={selectItem(setDeleteOpen)}
            className="gap-2.5 rounded-none border-t border-line px-3.5 py-3 text-body-sm font-semibold text-destructive focus:text-destructive"
          >
            <Trash2 className="size-[15px]" />
            {t("deleteUser")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserActionConfirm
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t("revokeTokens")}
        description={t("revokeTokensConfirm", { email })}
        entityLabel={email}
        confirmLabel={t("revokeTokens")}
        variant="default"
        requiresTyping={false}
        onConfirm={async () => {
          const { revoked } = await api.adminRevokeUserTokens(userId);
          toast.success(t("revokeTokensDone", { count: revoked }));
          router.refresh();
        }}
      />
      <UserActionConfirm
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("resetOnboarding")}
        description={t("resetOnboardingConfirm", { email })}
        entityLabel={email}
        confirmLabel={t("resetOnboarding")}
        variant="default"
        requiresTyping={false}
        onConfirm={async () => {
          await api.adminResetUserOnboarding(userId);
          toast.success(t("resetOnboardingDone"));
          router.refresh();
        }}
      />
      <UserActionConfirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteUser")}
        description={t("deleteUserConfirm", { email })}
        entityLabel={email}
        confirmLabel={t("deleteUser")}
        variant="destructive"
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

/**
 * One admin confirm step on top of the shared `ui/ConfirmActionDialog`: shows the
 * affected user, optionally gates the confirm button behind typing the localised
 * confirmation word, and keeps the dialog open with an inline error if the action fails.
 * (This used to be a second, parallel `components/confirm-action-dialog.tsx`.)
 */
function UserActionConfirm({
  open,
  onOpenChange,
  title,
  description,
  entityLabel,
  confirmLabel,
  variant = "destructive",
  requiresTyping = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  entityLabel: string;
  confirmLabel: string;
  variant?: "destructive" | "default";
  requiresTyping?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("Admin");
  // The word to type is localised (placeholder key doubles as the expected word).
  const confirmWord = t("confirmActionInputPlaceholder");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [typed, setTyped] = useState("");
  const inputId = useId();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(false);
      setBusy(false);
      setTyped("");
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    setBusy(true);
    setError(false);
    try {
      await onConfirm();
      handleOpenChange(false);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      variant={variant}
      busy={busy}
      confirmDisabled={requiresTyping && typed.trim() !== confirmWord}
      onConfirm={() => void handleConfirm()}
    >
      {entityLabel && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground">
          {entityLabel}
        </p>
      )}
      {requiresTyping && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor={inputId}>
            {t("confirmActionTypeToConfirm", { word: confirmWord })}
          </label>
          <Input
            id={inputId}
            placeholder={t("confirmActionInputPlaceholder")}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>
      )}
      {error && <ErrorBanner>{t("updateError")}</ErrorBanner>}
    </ConfirmActionDialog>
  );
}
