"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UploadStepProps {
  dragActive: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  reImportFile: File | null;
  onReImport: (file: File) => void;
  /** Selects the title/hint copy below — see `UseImportFlowProps.entryMode`. Defaults to
   *  the generic "file" copy (unchanged from before this prop existed). */
  entryMode?: "screenshot" | "csv" | "file";
}

export function UploadStep({
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  fileRef,
  onPick,
  error,
  reImportFile,
  onReImport,
  entryMode = "file",
}: UploadStepProps) {
  const t = useTranslations("Import");
  const title =
    entryMode === "screenshot"
      ? t("dropzone.titleScreenshot")
      : entryMode === "csv"
        ? t("dropzone.titleCsv")
        : t("dropzone.title");
  const hint =
    entryMode === "screenshot"
      ? t("dropzone.hintScreenshot")
      : entryMode === "csv"
        ? t("dropzone.hintCsv")
        : t("dropzone.hint");

  return (
    <div className="space-y-4">
      <button
        type="button"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center transition-colors",
          dragActive ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-card",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-lg bg-secondary">
          <Upload className="size-6 text-primary" />
        </span>
        {dragActive ? (
          <span className="font-medium text-primary">{t("dropzone.dropHere")}</span>
        ) : (
          <>
            <span className="font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">{hint}</span>
            <span className="mt-1 inline-flex items-center gap-2 text-sm text-primary">
              <Upload className="size-4" />
              {t("dropzone.cta")}
            </span>
          </>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,image/*,application/pdf"
        multiple
        className="sr-only"
        aria-label={t("dropzone.cta")}
        onChange={onPick}
      />
      {error && (
        <ErrorBanner className="flex-wrap">
          <span>{error}</span>
          {reImportFile && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => onReImport(reImportFile)}
            >
              {t("reImportAnyway")}
            </Button>
          )}
        </ErrorBanner>
      )}
    </div>
  );
}
