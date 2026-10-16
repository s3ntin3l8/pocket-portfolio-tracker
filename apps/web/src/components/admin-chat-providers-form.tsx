"use client";

import { Card } from "@/components/ui/card";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowDown, ArrowUp, Check } from "lucide-react";
import type {
  AdminChatProvider,
  AdminChatProvidersResponse,
  ApiClient,
} from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

/** The slice of the API client this form needs (injectable for tests). */
export type AdminChatProvidersClient = Pick<
  ApiClient,
  "updateAdminChatProviders" | "resetAdminChatProviders"
>;

const NO_PIN = "";

/** What the user can change, as one comparable string. */
const signature = (rows: AdminChatProvider[], models: Record<string, string>, pin: string) =>
  JSON.stringify([rows.map((r) => [r.id, r.enabled]), models, pin]);

export function AdminChatProvidersForm({
  client,
  initial,
  onSuccess,
}: {
  client: AdminChatProvidersClient;
  initial: AdminChatProvidersResponse;
  onSuccess?: () => void;
}) {
  const t = useTranslations("Admin");
  const [view, setView] = useState(initial);
  const [rows, setRows] = useState(initial.providers);
  const [models, setModels] = useState(modelDraft(initial.providers));
  const [pin, setPin] = useState(
    initial.pinnedSource === "db" ? (initial.pinned ?? NO_PIN) : NO_PIN,
  );
  const [baseline, setBaseline] = useState(signature(rows, models, pin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState<"save" | "reset" | null>(null);

  const dirty = signature(rows, models, pin) !== baseline;
  const inherited = rows.some((r) => r.enabledSource === "vision" || r.prioritySource === "vision");
  const active = view.providers.find((p) => p.id === view.activeProvider);

  function apply(res: AdminChatProvidersResponse, kind: "save" | "reset") {
    const nextModels = modelDraft(res.providers);
    const nextPin = res.pinnedSource === "db" ? (res.pinned ?? NO_PIN) : NO_PIN;
    setView(res);
    setRows(res.providers);
    setModels(nextModels);
    setPin(nextPin);
    setBaseline(signature(res.providers, nextModels, nextPin));
    setSaved(kind);
    onSuccess?.();
  }

  function move(i: number, by: -1 | 1) {
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row!);
      return next;
    });
    setSaved(null);
  }

  async function run(action: () => Promise<AdminChatProvidersResponse>, kind: "save" | "reset") {
    if (busy) return;
    setBusy(true);
    setError(false);
    setSaved(null);
    try {
      apply(await action(), kind);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    void run(
      () =>
        client.updateAdminChatProviders({
          providers: rows.map((r, i) => ({
            id: r.id,
            enabled: r.enabled,
            priority: i + 1,
            // Blank = no override: fall back to the env var / adapter default.
            model: models[r.id]?.trim() ? models[r.id]!.trim() : null,
          })),
          pinned: pin === NO_PIN ? null : pin,
        }),
      "save",
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {t("updateError")}
        </div>
      )}

      <p
        role="status"
        className="rounded-xl bg-card px-4 py-3 text-sm shadow-card"
        data-testid="chat-active"
      >
        {active ? (
          <>
            <span className="text-muted-foreground">{t("chatAnswersNow")}: </span>
            <span className="font-bold">{active.label}</span>
            {active.model && <span className="text-muted-foreground"> · {active.model}</span>}
          </>
        ) : (
          <span className="text-destructive">{t("chatNoneActive")}</span>
        )}
      </p>

      <Card className="overflow-hidden">
        {rows.map((p, i) => (
          <div key={p.id} className={i > 0 ? "border-t border-line" : ""}>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-background text-micro font-bold text-text-2">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{p.label}</div>
                {!p.configured && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t("chatNotConfigured")}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`${t("chatMoveUp")}: ${p.label}`}
                  className="flex size-8 items-center justify-center rounded-sm text-text-2 hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`${t("chatMoveDown")}: ${p.label}`}
                  className="flex size-8 items-center justify-center rounded-sm text-text-2 hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
              </div>
              <Switch
                checked={p.enabled}
                onCheckedChange={(on) => {
                  setRows((rs) => rs.map((r) => (r.id === p.id ? { ...r, enabled: on } : r)));
                  setSaved(null);
                }}
                aria-label={`${p.enabled ? t("enabled") : t("disabled")}: ${p.label}`}
              />
            </div>
            <div className="px-4 pb-3.5 pl-[54px]">
              <label
                className="block text-xs font-semibold text-text-2"
                htmlFor={`chat-model-${p.id}`}
              >
                {t("chatModel")}
              </label>
              <input
                id={`chat-model-${p.id}`}
                value={models[p.id] ?? ""}
                onChange={(e) => {
                  setModels((m) => ({ ...m, [p.id]: e.target.value }));
                  setSaved(null);
                }}
                placeholder={modelPlaceholder(p, t)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        ))}
      </Card>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold" htmlFor="chat-pin">
          {t("chatPin")}
        </label>
        <select
          id="chat-pin"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setSaved(null);
          }}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        >
          <option value={NO_PIN}>{t("chatPinNone")}</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t("chatPinHint")}</p>
        {view.pinnedSource === "env" && pin === NO_PIN && (
          <p className="text-xs text-muted-foreground">{t("chatPinFromEnv")}</p>
        )}
      </div>

      {inherited && !dirty && saved === null && (
        <p className="text-xs text-muted-foreground">{t("chatInherited")}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy && <Spinner size="sm" />}
          {busy ? t("saving") : t("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => client.resetAdminChatProviders(), "reset")}
        >
          {t("chatReset")}
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {saved === "reset" ? t("chatResetDone") : t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}

/** Only models set here (source "db") are editable text; env/default ones show as placeholders. */
function modelDraft(providers: AdminChatProvider[]): Record<string, string> {
  return Object.fromEntries(
    providers.map((p) => [p.id, p.modelSource === "db" ? (p.model ?? "") : ""]),
  );
}

function modelPlaceholder(p: AdminChatProvider, t: ReturnType<typeof useTranslations>) {
  if (p.modelSource === "env" && p.model) {
    return t("chatModelPlaceholderEnv", { value: p.model, source: p.modelEnvVar });
  }
  if (p.modelSource === "default" && p.model) return t("chatModelDefault", { value: p.model });
  return t("chatModelRequired");
}
