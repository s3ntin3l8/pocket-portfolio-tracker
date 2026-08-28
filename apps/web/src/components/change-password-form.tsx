"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { AlertCircle, Check } from "lucide-react";
import { apiErrorCode } from "@portfolio/api-client";
import type { ApiClient } from "@portfolio/api-client";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD_LENGTH = 8;

/** The slice of the API client this form needs (injectable for tests). */
export type ChangePasswordClient = Pick<ApiClient, "changeLocalPassword">;

/**
 * Change-password form for local email/password auth (POST /auth/local/change-password
 * already existed API-side, tested and rate-limited, but had no UI anywhere in the app
 * until this). Only rendered when local auth is configured — see AccountSection.
 */
export function ChangePasswordForm({
  client,
  email,
}: {
  client: ChangePasswordClient;
  /** The signed-in user's own email — used to silently re-authenticate after a
   *  successful change (see submit()) so the caller isn't bounced to sign-in by their
   *  own "sign out everywhere" revocation. */
  email: string;
}) {
  const t = useTranslations("Settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = currentPassword.length > 0 && newPassword.length > 0;

  function messageForError(err: unknown): string {
    const code = apiErrorCode(err);
    if (code && t.has(`changePasswordErrors.${code}`)) {
      return t(`changePasswordErrors.${code}`);
    }
    return t("changePasswordErrors.generic");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setError(null);
    setSaved(false);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("passwordTooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setBusy(true);
    try {
      await client.changeLocalPassword({ currentPassword, newPassword });
      // The change just stamped passwordChangedAt, which invalidates the local JWT this
      // very request authenticated with (see plugins/auth.ts) — without this, the next
      // API call 401s and the user is silently bounced to sign-in right after a
      // successful "Password changed". Re-authenticate with the new password (same
      // redirect:false pattern the login form uses) to mint a fresh, valid session
      // before reporting success.
      const result = await signIn("credentials", {
        email,
        password: newPassword,
        redirect: false,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (result?.error) {
        setError(t("changePasswordErrors.reauthFailed"));
      } else {
        setSaved(true);
      }
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="current-password">{t("currentPasswordLabel")}</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">{t("newPasswordLabel")}</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-new-password">{t("confirmNewPasswordLabel")}</Label>
        <Input
          id="confirm-new-password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setSaved(false);
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy && <Spinner size="sm" />}
          {busy ? t("changingPassword") : t("changePassword")}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {t("passwordChanged")}
          </span>
        )}
      </div>
    </form>
  );
}
