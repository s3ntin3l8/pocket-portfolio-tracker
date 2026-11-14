"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import type {
  AdminAiConnection,
  AdminAiModel,
  AdminAiResponse,
  AdminAiTask,
} from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiCall } from "@/lib/use-api-call";
import { ModelCombobox } from "./model-combobox";
import { EFFORTS, type AdminAiClient } from "./types";

type Task = AdminAiTask["task"];

/** Literal message keys (a dynamic `t(\`…${x}\`)` can't be checked against the catalogue). */
const EFFORT_LABEL = {
  low: "aiEffortLevel.low",
  medium: "aiEffortLevel.medium",
  high: "aiEffortLevel.high",
  xhigh: "aiEffortLevel.xhigh",
  max: "aiEffortLevel.max",
} as const satisfies Record<(typeof EFFORTS)[number], string>;

/** The provider's model list for a task; reloads when the provider or its credential changes. */
function useModels(client: AdminAiClient, provider: string, task: Task, credential: string) {
  const key = provider ? `${provider}|${task}|${credential}` : "";
  const [loaded, setLoaded] = useState<{ key: string; models: AdminAiModel[]; failed: boolean }>();

  useEffect(() => {
    if (!provider) return;
    let stale = false;
    client
      .listAdminAiModels(provider, task)
      .then((r) => !stale && setLoaded({ key, models: r.models, failed: Boolean(r.error) }))
      .catch(() => !stale && setLoaded({ key, models: [], failed: true }));
    return () => {
      stale = true;
    };
  }, [client, provider, task, key]);

  const ready = loaded?.key === key;
  return {
    models: ready ? loaded.models : [],
    loading: Boolean(provider) && !ready,
    failed: ready && loaded.failed,
  };
}

/**
 * One AI task (document reading or the assistant): exactly one provider and one model. The
 * provider list is the connected providers; the model list comes from the provider's own API.
 */
export function TaskCard({
  task,
  setting,
  connections,
  client,
  onSaved,
}: {
  task: Task;
  setting: AdminAiTask;
  connections: AdminAiConnection[];
  client: AdminAiClient;
  onSaved: (res: AdminAiResponse) => void;
}) {
  const t = useTranslations("Admin");
  const [provider, setProvider] = useState(setting.provider ?? "");
  const [model, setModel] = useState(setting.model ?? "");
  const [effort, setEffort] = useState(setting.effort ?? "");
  const [saved, setSaved] = useState(false);
  const providerId = useId();
  const effortId = useId();

  const connection = connections.find((c) => c.id === provider);
  const { models, loading, failed } = useModels(
    client,
    provider,
    task,
    connection
      ? `${connection.hasKey}${connection.hasUrl}${connection.keySource}${connection.url ?? ""}${connection.keyHint ?? ""}`
      : "",
  );

  const showEffort = task === "chat" && provider === "claude";
  const dirty =
    provider !== (setting.provider ?? "") ||
    model !== (setting.model ?? "") ||
    (showEffort ? effort : "") !== (setting.effort ?? "");
  const canSave = dirty && (provider === "" || model.trim() !== "");

  const [{ busy, error }, save] = useApiCall(
    useCallback(async () => {
      const res = await client.updateAdminAiTask(task, {
        provider: provider || null,
        model: provider ? model.trim() : null,
        effort: showEffort && effort ? (effort as (typeof EFFORTS)[number]) : null,
      });
      setSaved(true);
      onSaved(res);
    }, [client, task, provider, model, effort, showEffort, onSaved]),
    { fallbackMessage: t("updateError") },
  );

  const options = connections.filter((c) => c.configured || c.id === setting.provider);
  const local = connection?.local === true;
  const privacy =
    task === "chat"
      ? local
        ? t("aiPrivacyLocalChat")
        : t("aiPrivacyCloudChat", { provider: connection?.label ?? "" })
      : local
        ? t("aiPrivacyLocalVision")
        : t("aiPrivacyCloudVision", { provider: connection?.label ?? "" });

  return (
    <Card className="space-y-4 p-4" data-testid={`ai-task-${task}`}>
      <div>
        <h2 className="text-sm font-bold">
          {t(task === "vision" ? "aiVisionTitle" : "aiChatTitle")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(task === "vision" ? "aiVisionHint" : "aiChatHint")}
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="space-y-1.5">
        <label htmlFor={providerId} className="block text-xs font-semibold text-text-2">
          {t("aiProvider")}
        </label>
        <Select
          id={providerId}
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel("");
            setEffort("");
            setSaved(false);
          }}
        >
          <option value="">{t("aiProviderOff")}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.configured ? c.label : t("aiProviderNotConnected", { label: c.label })}
            </option>
          ))}
        </Select>
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("aiNoConnection")}</p>
        )}
      </div>

      {provider && (
        <>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-text-2">{t("aiModel")}</div>
            <ModelCombobox
              label={t("aiModel")}
              value={model}
              onChange={(m) => {
                setModel(m);
                setSaved(false);
              }}
              models={models}
              loading={loading}
              failed={failed}
              capability={task === "vision" ? "vision" : "tools"}
            />
          </div>

          {showEffort && (
            <div className="space-y-1.5">
              <label htmlFor={effortId} className="block text-xs font-semibold text-text-2">
                {t("aiEffort")}
              </label>
              <Select
                id={effortId}
                value={effort}
                onChange={(e) => {
                  setEffort(e.target.value);
                  setSaved(false);
                }}
              >
                <option value="">{t("aiEffortDefault")}</option>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {t(EFFORT_LABEL[e])}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <p
            className={`flex items-start gap-1.5 text-xs ${local ? "text-text-2" : "text-muted-foreground"}`}
          >
            {local ? (
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : (
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            )}
            {privacy}
          </p>
          {task === "vision" && (provider === "ollama" || provider === "openai-compatible") && (
            <p className="text-xs text-muted-foreground">{t("aiOllamaPdf")}</p>
          )}
        </>
      )}

      {setting.provider && !setting.usable && !dirty && (
        <p role="status" className="text-xs text-destructive">
          {t("aiTaskUnusable")}
        </p>
      )}
      {!setting.provider && !dirty && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("aiTaskOff")}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" disabled={busy || !canSave} onClick={() => void save()}>
          {busy && <Spinner size="sm" />}
          {busy ? t("saving") : t("save")}
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {t("saved")}
          </span>
        )}
      </div>
    </Card>
  );
}
