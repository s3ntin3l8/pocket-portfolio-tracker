"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, ShieldOff } from "lucide-react";
import type {
  AdminAiConnection,
  AdminAiResponse,
  ProviderCredentialInput,
} from "@portfolio/api-client";
import { CredentialEditorPanel } from "@/components/admin/credential-editor-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useApiCall } from "@/lib/use-api-call";
import type { AdminAiClient } from "./types";

const hasCredential = (c: AdminAiConnection) =>
  c.credential === "url" ? c.hasUrl || (c.optionalKey && c.hasKey) : c.hasKey;

/** The key/URL state line under a provider's name. Never shows a secret, only a hint. */
function StatusLine({
  connection: c,
  encryptionEnabled,
}: {
  connection: AdminAiConnection;
  encryptionEnabled: boolean;
}) {
  const t = useTranslations("Admin");
  if (!encryptionEnabled) {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {c.url ? (
          <span className="break-all font-mono">{c.url}</span>
        ) : (
          c.keySource === "env" && <span className="font-mono">{t("keyFromEnv")}</span>
        )}
        <span className="inline-flex items-center gap-1 text-warning">
          <ShieldOff className="size-3 shrink-0" />
          {t("encryptionDisabled")}
        </span>
      </span>
    );
  }
  if (c.credential === "url") {
    // The URL itself is shown (it isn't secret); a stored key only as its hint.
    const base = c.url ?? (hasCredential(c) ? t("visionUrlSet") : null);
    const text = base
      ? `${base}${c.keyHint ? ` · ${c.keyHint}` : ""}`
      : c.keySource === "env"
        ? t("keyFromEnv")
        : t("keyNone");
    return <span className="break-all font-mono">{text}</span>;
  }
  const text = hasCredential(c)
    ? (c.keyHint ?? "••••")
    : c.keySource === "env"
      ? t("keyFromEnv")
      : t("keyNone");
  return <span className="font-mono">{text}</span>;
}

function TestButton({
  connection,
  client,
}: {
  connection: AdminAiConnection;
  client: AdminAiClient;
}) {
  const t = useTranslations("Admin");
  const [result, setResult] = useState<{ error?: string } | null>(null);
  const [{ busy }, run] = useApiCall(
    useCallback(async () => {
      setResult(null);
      try {
        setResult(await client.listAdminAiModels(connection.id, "chat"));
      } catch {
        setResult({ error: "provider_unreachable" });
      }
    }, [client, connection.id]),
  );
  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="shrink-0 rounded-sm bg-background px-2.5 py-1.5 text-micro font-bold text-text-2 hover:text-foreground disabled:opacity-50"
      >
        {busy ? <Spinner size="sm" /> : t("aiTest")}
      </button>
      {result && (
        <span
          role="status"
          className={`basis-full text-xs ${result.error ? "text-destructive" : "text-success-strong"}`}
        >
          {result.error ? t("aiTestFailed", { code: result.error }) : t("aiTestOk")}
        </span>
      )}
    </>
  );
}

/**
 * The providers' connections: one key (or, for Ollama and OpenAI-compatible servers, a URL) per provider, shared by both
 * tasks. Saving a key needs server-side encryption; picking a provider for a task does not.
 */
export function ConnectionsCard({
  connections,
  encryptionEnabled,
  client,
  onChange,
}: {
  connections: AdminAiConnection[];
  encryptionEnabled: boolean;
  client: AdminAiClient;
  onChange: (res: AdminAiResponse) => void;
}) {
  const t = useTranslations("Admin");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [optionError, setOptionError] = useState(false);

  async function toggleDataCollection(id: string, on: boolean) {
    setOptionError(false);
    try {
      onChange(await client.updateAdminAiProvider(id, { allowDataCollection: on }));
    } catch {
      setOptionError(true);
    }
  }

  return (
    <section className="space-y-2" aria-labelledby="ai-connections">
      <div>
        <h2 id="ai-connections" className="text-sm font-bold">
          {t("aiConnections")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("aiConnectionsHint")}</p>
      </div>
      {optionError && <ErrorBanner>{t("updateError")}</ErrorBanner>}
      <Card className="overflow-hidden">
        {connections.map((c, i) => {
          const editing = editingId === c.id;
          const isUrl = c.credential === "url";
          return (
            <div key={c.id} className={i > 0 ? "border-t border-line" : ""}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold">{c.label}</span>
                    {c.local === true && <Badge variant="success">{t("aiLocal")}</Badge>}
                    {c.local === false && <Badge variant="warning">{t("aiRemote")}</Badge>}
                  </div>
                  <div className="mt-0.5 break-words text-xs text-muted-foreground">
                    <StatusLine connection={c} encryptionEnabled={encryptionEnabled} />
                  </div>
                </div>
                {c.configured && <TestButton connection={c} client={client} />}
                {encryptionEnabled && !c.configured && (
                  <button
                    type="button"
                    onClick={() => setEditingId(c.id)}
                    className="shrink-0 whitespace-nowrap rounded-sm bg-primary/10 px-2.5 py-1.5 text-micro font-bold text-primary-strong"
                  >
                    {t("credentialSet")}
                  </button>
                )}
                {encryptionEnabled && c.configured && (
                  <button
                    type="button"
                    onClick={() => setEditingId(editing ? null : c.id)}
                    aria-label={`${t("editCredential")}: ${c.label}`}
                    className="flex size-[30px] shrink-0 items-center justify-center rounded-sm bg-background text-text-2 hover:text-foreground"
                  >
                    <Pencil className="size-[15px]" />
                  </button>
                )}
              </div>
              {c.id === "openrouter" && (
                <div className="flex items-start justify-between gap-3 px-4 pb-3.5">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text-2">{t("aiDataCollection")}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("aiDataCollectionHint")}
                    </p>
                  </div>
                  <Switch
                    checked={c.allowDataCollection === true}
                    onCheckedChange={(on) => void toggleDataCollection(c.id, on)}
                    aria-label={t("aiDataCollection")}
                  />
                </div>
              )}
              {editing && (
                <CredentialEditorPanel
                  label={c.label}
                  isUrl={isUrl}
                  // Prefill only a stored URL: saving an env one would silently pin it in the DB.
                  initialValue={isUrl && c.hasUrl ? (c.url ?? "") : ""}
                  urlPlaceholder={
                    c.id === "openai-compatible" ? t("aiOpenAiCompatUrlPlaceholder") : undefined
                  }
                  optionalKey={isUrl && c.optionalKey}
                  hasKey={c.hasKey}
                  hasCredential={hasCredential(c)}
                  onSave={async (value, key) => {
                    const body: ProviderCredentialInput = isUrl
                      ? { urlOverride: value, ...(key ? { apiKey: key } : {}) }
                      : { apiKey: value };
                    onChange(await client.setAdminAiCredential(c.id, body));
                  }}
                  onClear={async () => onChange(await client.clearAdminAiCredential(c.id))}
                  onClose={() => setEditingId(null)}
                />
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
