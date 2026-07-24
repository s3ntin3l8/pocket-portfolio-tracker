"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, CheckCircle, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { StorageSettingsUpdate } from "@portfolio/api-client";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AdminStorageClient, AdminStorageFormProps, Provider } from "./admin-storage/types";
import { SourceBadge } from "./admin-storage/source-badge";
import { SecretCell } from "./admin-storage/secret-cell";
import { Field } from "./admin-storage/field";

const PROVIDER_OPTIONS: { value: Provider; labelKey: "storageFolder" | "storageS3" }[] = [
  { value: "folder", labelKey: "storageFolder" },
  { value: "s3", labelKey: "storageS3" },
];

export function AdminStorageForm({ initial }: AdminStorageFormProps) {
  const t = useTranslations("Admin");
  const router = useRouter();
  const api = useApiClient() as AdminStorageClient;

  const [activeProvider, setActiveProvider] = useState<Provider>(initial.activeProvider);
  const [s3, setS3] = useState(initial.s3);
  const [folder, setFolder] = useState(initial.folder);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "failed">("idle");
  const [testError, setTestError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setSaved(false);
    setSaveError(null);
    try {
      const patch: StorageSettingsUpdate = {
        activeProvider,
        s3Endpoint: s3.endpoint || null,
        s3Region: s3.region || null,
        s3Bucket: s3.bucket || null,
        s3AccessKeyId: s3.accessKeyId || null,
        s3ForcePathStyle: s3.forcePathStyle,
        s3SignedUrlTtl: s3.signedUrlTtl,
        folderPath: folder.path || null,
      };
      const updated = await api.updateAdminStorageProviders(patch);
      setS3(updated.s3);
      setFolder(updated.folder);
      setActiveProvider(updated.activeProvider);
      setSaved(true);
      router.refresh();
    } catch {
      setSaveError(t("updateError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleTestConnection() {
    setTestState("testing");
    setTestError(null);
    try {
      const result = await api.testAdminStorageProvider();
      if (result.ok) {
        setTestState("ok");
      } else {
        setTestState("failed");
        setTestError(result.error ?? "Unknown error");
      }
    } catch (err) {
      setTestState("failed");
      setTestError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="rounded-[20px] bg-card p-4 shadow-card">
      <div className="mb-3.5 space-y-1.5">
        <label
          htmlFor="storage-provider"
          className="block px-0.5 text-xs font-semibold text-text-2"
        >
          {t("storageProvider")}
        </label>
        <select
          id="storage-provider"
          value={activeProvider}
          onChange={(e) => {
            const next = PROVIDER_OPTIONS.find((o) => o.value === e.target.value)?.value;
            if (next) setActiveProvider(next);
          }}
          className="w-full appearance-none rounded-[12px] border border-border bg-background px-3.5 py-3 text-sm font-semibold outline-none"
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {activeProvider === "folder" && (
        <div className="space-y-1.5">
          <Field
            label={t("storageFolderPath")}
            value={folder.path}
            placeholder={t("storageFolderPathPlaceholder")}
            source={folder.pathSource}
            monospace
            onChange={(v) => setFolder((p) => ({ ...p, path: v, pathSource: "db" }))}
          />
          {!initial.encryptionEnabled && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3 shrink-0" />
              {t("storageEncryptionRequired")}
            </div>
          )}
        </div>
      )}

      {activeProvider === "s3" && (
        <div className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
            <Field
              label={t("storageEndpoint")}
              value={s3.endpoint}
              placeholder={t("storageEndpointPlaceholder")}
              source={s3.endpointSource}
              onChange={(v) => setS3((p) => ({ ...p, endpoint: v, endpointSource: "db" }))}
            />
            <Field
              label={t("storageRegion")}
              value={s3.region}
              source={s3.regionSource}
              onChange={(v) => setS3((p) => ({ ...p, region: v, regionSource: "db" }))}
            />
          </div>
          <Field
            label={t("storageBucket")}
            value={s3.bucket}
            source={s3.bucketSource}
            onChange={(v) => setS3((p) => ({ ...p, bucket: v, bucketSource: "db" }))}
          />
          <Field
            label={t("storageAccessKeyId")}
            value={s3.accessKeyId}
            source={s3.accessKeyIdSource}
            monospace
            onChange={(v) => setS3((p) => ({ ...p, accessKeyId: v, accessKeyIdSource: "db" }))}
          />
          <SecretCell
            encryptionEnabled={initial.encryptionEnabled}
            hasSecret={s3.hasSecret}
            secretHint={s3.secretHint}
            secretSource={s3.secretSource}
            onSet={async (body) => {
              const updated = await api.setAdminStorageS3Secret(body);
              setS3(updated.s3);
              router.refresh();
            }}
            onClear={async () => {
              const updated = await api.clearAdminStorageS3Secret();
              setS3(updated.s3);
              router.refresh();
            }}
          />
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-text-2">
                {t("storageForcePathStyle")}
              </span>
              <SourceBadge source={s3.forcePathStyleSource} />
            </div>
            <Switch
              checked={s3.forcePathStyle}
              onCheckedChange={(v) =>
                setS3((p) => ({ ...p, forcePathStyle: v, forcePathStyleSource: "db" }))
              }
            />
          </div>
          <Field
            label={t("storageSignedUrlTtl")}
            value={String(s3.signedUrlTtl)}
            source={s3.signedUrlTtlSource}
            type="number"
            onChange={(v) =>
              setS3((p) => ({
                ...p,
                signedUrlTtl: parseInt(v, 10) || 3600,
                signedUrlTtlSource: "db",
              }))
            }
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testState === "testing"}
              className="flex items-center gap-1.5 rounded-[12px] border border-border bg-background px-4 py-2.5 text-[13px] font-bold disabled:cursor-default disabled:opacity-60"
            >
              {testState === "testing" && <Spinner size="sm" />}
              {testState === "testing" ? t("storageTesting") : t("storageTestConnection")}
            </button>
            {testState === "ok" && (
              <span className="flex items-center gap-1 text-xs font-bold text-primary">
                <CheckCircle className="size-[15px]" />
                {t("storageTestOk")}
              </span>
            )}
            {testState === "failed" && (
              <span className="flex items-center gap-1 text-xs font-bold text-destructive">
                <XCircle className="size-[15px]" />
                {t("storageTestFailed")}
                {testError && <span className="font-mono font-normal">{testError}</span>}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="my-4 h-px bg-line" />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className={cn(
            "flex items-center gap-1.5 rounded-[12px] bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground",
            busy && "cursor-default opacity-70",
          )}
        >
          {busy && <Spinner size="sm" />}
          {busy ? t("saving") : t("storageSave")}
        </button>
        {saved && !saveError && (
          <span className="flex items-center gap-1 text-sm text-primary">
            <Check className="size-4" />
            {t("saved")}
          </span>
        )}
        {saveError && (
          <span role="alert" className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
