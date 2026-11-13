"use client";

import { useCallback, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { useApiCall } from "@/lib/use-api-call";

/**
 * The design's inline expanding credential editor (`Admin Settings.dc.html`) — a card-2
 * inset panel that opens *below* a provider/secret row rather than in a shadcn `Dialog`
 * popup. Value/show/busy/error state is self-contained here (not shared with
 * `admin/use-credential-dialog.ts`, which still backs the `Dialog`-based storage secret
 * cell until that's rebuilt too — see PR B2); *visibility* (which row's editor is open)
 * is owned by the parent list so only one editor is expanded at a time.
 */
export function CredentialEditorPanel({
  label,
  isUrl,
  initialValue = "",
  urlPlaceholder,
  optionalKey,
  hasKey,
  hasCredential,
  onSave,
  onClear,
  onClose,
}: {
  /** Provider label, interpolated into "API key · {label}" (or "URL · {label}"). */
  label: string;
  /** Ollama-style URL-based credential — no show/hide eye, `type="url"`, different placeholder. */
  isUrl?: boolean;
  /** Prefill (the URL currently in use). */
  initialValue?: string;
  /** Placeholder for the URL field; defaults to Ollama's. */
  urlPlaceholder?: string;
  /** A URL credential that also takes an optional API key (an authenticated OpenAI-compatible server). */
  optionalKey?: boolean;
  /** An API key is already stored (only meaningful with `optionalKey`). */
  hasKey?: boolean;
  hasCredential: boolean;
  /** `key` is the optional API key, only passed (non-empty) when `optionalKey` and one was typed. */
  onSave: (value: string, key?: string) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("Admin");
  const [value, setValue] = useState(initialValue);
  const [key, setKey] = useState("");
  const [showValue, setShowValue] = useState(false);

  const [saveState, save] = useApiCall(
    useCallback(async () => {
      const v = value.trim();
      if (!v) return;
      const k = optionalKey ? key.trim() : "";
      await (k ? onSave(v, k) : onSave(v));
      onClose();
    }, [value, key, optionalKey, onSave, onClose]),
    { fallbackMessage: t("credentialError") },
  );
  const [clearState, clear] = useApiCall(
    useCallback(async () => {
      await onClear();
      onClose();
    }, [onClear, onClose]),
    { fallbackMessage: t("credentialError") },
  );

  const inputId = useId();
  const keyId = useId();
  const busy = saveState.busy || clearState.busy;
  const error = saveState.error ?? clearState.error;
  const trimmed = value.trim();

  return (
    <div className="border-t border-line bg-card px-3.5 pb-3.5 pt-2.5">
      <div className="rounded-md border border-border bg-card-2 p-3.5">
        <label htmlFor={inputId} className="mb-1.5 block px-0.5 text-xs font-semibold text-text-2">
          {isUrl ? t("credentialEditorUrlLabel", { label }) : t("credentialEditorLabel", { label })}
        </label>
        <div className="relative">
          <Input
            id={inputId}
            type={isUrl ? "url" : showValue ? "text" : "password"}
            placeholder={
              isUrl ? (urlPlaceholder ?? t("visionUrlPlaceholder")) : t("credentialPlaceholder")
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="pr-10 font-mono text-sm"
            autoComplete="off"
            autoFocus
          />
          {!isUrl && (
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-2 hover:text-foreground"
              aria-label={showValue ? t("credentialHide") : t("credentialShow")}
            >
              {showValue ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>
          )}
        </div>
        {isUrl && optionalKey && (
          <div className="mt-2.5">
            <label
              htmlFor={keyId}
              className="mb-1.5 block px-0.5 text-xs font-semibold text-text-2"
            >
              {t("credentialEditorOptionalKeyLabel", { label })}
            </label>
            <Input
              id={keyId}
              type="password"
              placeholder={t("credentialPlaceholder")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="font-mono text-sm"
              autoComplete="off"
            />
            {hasKey && (
              <p className="mt-1 px-0.5 text-micro text-text-2">{t("credentialOptionalKeyKeep")}</p>
            )}
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !trimmed}
            className="rounded-sm bg-primary px-4 py-2 text-body-sm font-bold text-primary-foreground disabled:cursor-default disabled:opacity-50"
          >
            {busy && !clearState.busy ? <Spinner size="sm" /> : t("credentialSave")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-3 py-2 text-body-sm font-bold text-text-2"
          >
            {t("credentialCancel")}
          </button>
          <span className="flex-1" />
          {hasCredential && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy}
              className="rounded-sm bg-destructive/10 px-3.5 py-2 text-body-sm font-bold text-destructive-strong disabled:cursor-default disabled:opacity-50"
            >
              {clearState.busy ? <Spinner size="sm" /> : t("credentialClear")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {/* Only true for API keys — a URL override (e.g. Ollama's) is saved as plain text
            even though writing it still requires encryption to be enabled server-side
            (services/api/src/routes/admin/ai.ts gates the credential route on
            `encryption.isEnabled`, not just the key case), so don't claim it's encrypted. */}
        {!isUrl && (
          <p className="mt-2.5 flex items-center gap-1.5 text-micro text-text-2">
            <Lock className="size-[13px] shrink-0 text-primary" strokeWidth={2} />
            {t("credentialStoredEncrypted")}
          </p>
        )}
      </div>
    </div>
  );
}
