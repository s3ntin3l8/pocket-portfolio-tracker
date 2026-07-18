"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, CheckCircle, HardDrive, Server, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { StorageSettingsUpdate } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import type { AdminStorageClient, AdminStorageFormProps, Provider } from "./admin-storage/types";
import { SourceBadge } from "./admin-storage/source-badge";
import { SecretCell } from "./admin-storage/secret-cell";
import { Field } from "./admin-storage/field";

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
    <div className="space-y-6">
      {/* Provider selection */}
      <div>
        <div className="text-sm font-medium mb-2">{t("storageProvider")}</div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setActiveProvider("s3")}
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${
              activeProvider === "s3"
                ? "border-primary bg-primary/5 text-primary"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <Server className="size-4" />
            {t("storageS3")}
          </button>
          <button
            type="button"
            onClick={() => setActiveProvider("folder")}
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${
              activeProvider === "folder"
                ? "border-primary bg-primary/5 text-primary"
                : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            <HardDrive className="size-4" />
            {t("storageFolder")}
          </button>
        </div>
      </div>

      {/* S3 config fields */}
      {activeProvider === "s3" && (
        <div className="space-y-3 rounded-lg border border-border p-4">
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
            onChange={(v) => setS3((p) => ({ ...p, accessKeyId: v, accessKeyIdSource: "db" }))}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-sm">{t("storageForcePathStyle")}</span>
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
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-sm">{t("storageSecretKey")}</span>
              <SourceBadge source={s3.secretSource} />
            </div>
            <SecretCell
              encryptionEnabled={initial.encryptionEnabled}
              hasSecret={s3.hasSecret}
              secretHint={s3.secretHint}
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
          </div>
        </div>
      )}

      {/* Folder config fields */}
      {activeProvider === "folder" && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <Field
            label={t("storageFolderPath")}
            value={folder.path}
            placeholder={t("storageFolderPathPlaceholder")}
            source={folder.pathSource}
            onChange={(v) => setFolder((p) => ({ ...p, path: v, pathSource: "db" }))}
          />
          {!initial.encryptionEnabled && (
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3" />
              {t("storageEncryptionRequired")}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleSave} disabled={busy}>
          {busy ? (
            <>
              <Spinner size="sm" className="mr-1" />
              {t("saving")}
            </>
          ) : (
            t("storageSave")
          )}
        </Button>
        {saved && !saveError && (
          <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
            <Check className="size-4" />
            {t("saved")}
          </span>
        )}
        {saveError && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {saveError}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testState === "testing"}
          >
            {testState === "testing" ? (
              <>
                <Spinner size="sm" className="mr-1" />
                {t("storageTesting")}
              </>
            ) : (
              t("storageTestConnection")
            )}
          </Button>
          {testState === "ok" && (
            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="size-4" />
              {t("storageTestOk")}
            </span>
          )}
          {testState === "failed" && (
            <span className="flex items-center gap-1 text-sm text-destructive">
              <XCircle className="size-4" />
              {t("storageTestFailed")}
              {testError && <span className="text-xs ml-1 font-mono">{testError}</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
