"use client";

import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PortfolioPicker } from "@/components/portfolio-picker";
import { ContractReview } from "@/components/contract-review";
import { ImportFilesTable } from "@/components/import-files-table";
import type {
  SkippedFile,
  ImportContract,
  ImportTargetPortfolio,
  ReviewDraft,
  ReviewGroup,
  IssueMap,
  PortfolioByImportMap,
} from "./types";
import type { AccountMismatch } from "@portfolio/api-client";

export interface ReviewStepProps {
  accountMismatch: AccountMismatch | null;
  mismatchImportId: string;
  submitting: boolean;
  onMaterializeImportAnyway: () => void;
  onConfirmImportAnyway: () => void;
  groups: Map<string, string>;
  skipped: SkippedFile[];
  onSkippedChange: (s: SkippedFile[] | ((prev: SkippedFile[]) => SkippedFile[])) => void;
  onReImportFile: (files: File[], force?: boolean) => void;
  savedReports: { file: string; title: string }[];
  contracts: ImportContract[];
  onUpdateContract: (index: number, patch: Partial<ImportContract>) => void;
  onContractSubmitConfirm: () => void;
  onReset: () => void;
  drafts: ReviewDraft[];
  importId: string;
  portfolioByImport: PortfolioByImportMap;
  matchedImports: Set<string>;
  issueMap: IssueMap;
  onPortfolioChange: (iid: string, pid: string) => void;
  isMultiGroup: boolean;
  reviewGroups: ReviewGroup[] | undefined;
  portfolios: ImportTargetPortfolio[];
  onMaterialize: (acknowledge?: boolean) => void;
}

export function ReviewStep({
  accountMismatch,
  mismatchImportId,
  submitting,
  onMaterializeImportAnyway,
  onConfirmImportAnyway,
  groups,
  skipped,
  onSkippedChange,
  onReImportFile,
  savedReports,
  contracts,
  onUpdateContract,
  onContractSubmitConfirm,
  onReset,
  drafts,
  importId,
  portfolioByImport,
  matchedImports,
  issueMap,
  onPortfolioChange,
  isMultiGroup,
  reviewGroups,
  portfolios,
  onMaterialize,
}: ReviewStepProps) {
  const t = useTranslations("Import");

  return (
    <div className="space-y-6">
      {accountMismatch && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {groups.size > 1 && groups.get(mismatchImportId) && (
              <span className="block truncate font-medium">{groups.get(mismatchImportId)}</span>
            )}
            {accountMismatch.kind === "other_portfolio"
              ? t("accountMismatch.otherPortfolio", {
                  portfolio: accountMismatch.matchedName ?? "",
                  account: accountMismatch.detected,
                })
              : t("accountMismatch.noMatch", { account: accountMismatch.detected })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() =>
              drafts.length > 0 && contracts.length === 0
                ? onMaterializeImportAnyway()
                : onConfirmImportAnyway()
            }
          >
            {t("accountMismatch.importAnyway")}
          </Button>
        </div>
      )}

      {skipped.length > 0 && (
        <details className="rounded-md border border-border bg-muted/40 text-sm text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
            <AlertCircle className="size-3.5 shrink-0" />
            <span className="flex-1">{t("errorBanner.summary", { count: skipped.length })}</span>
            <ChevronDown className="size-3.5 shrink-0 transition-transform [[open]_&]:rotate-180" />
          </summary>
          <ul className="border-t border-border px-3 pb-2.5 pt-2 space-y-1.5">
            {skipped.map((s) => (
              <li key={s.file} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">
                  {t(`skipped.${s.reason}`, { file: s.file, provider: s.provider ?? "" })}
                </span>
                {s.reason === "alreadyConfirmed" && s.originalFile && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      const f = s.originalFile!;
                      onSkippedChange((prev) => prev.filter((x) => x.file !== s.file));
                      onReImportFile([f], true);
                    }}
                  >
                    {t("reImportAnyway")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {savedReports.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <ul className="flex-1 space-y-1">
            {savedReports.map((r) => (
              <li key={r.file}>{t("report.savedFile", { title: r.title })}</li>
            ))}
          </ul>
        </div>
      )}

      {contracts.length > 0 && (
        <ContractReview
          contracts={contracts}
          onUpdate={onUpdateContract}
          onConfirm={onContractSubmitConfirm}
          onDiscard={onReset}
        />
      )}

      {drafts.length > 0 && contracts.length === 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t("confirmPortfolio.title")}</h2>
          {isMultiGroup ? (
            <ImportFilesTable
              groups={reviewGroups!}
              portfolios={portfolios}
              portfolioByImport={portfolioByImport}
              matchedImports={matchedImports}
              countByImport={(iid) => drafts.filter((d) => d.importId === iid).length}
              issueCountByImport={(iid) => (issueMap.get(iid) ?? []).length}
              onPortfolioChange={onPortfolioChange}
            />
          ) : (
            (() => {
              const iid = importId;
              const count = drafts.filter((d) => d.importId === iid).length;
              const matched = matchedImports.has(iid);
              const issues = issueMap.get(iid) ?? [];
              return (
                <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
                  <p className="text-sm text-muted-foreground">
                    {t("confirmPortfolio.summary", { count })}
                  </p>
                  {portfolios.length > 1 && (
                    <div className="space-y-1.5">
                      <Label>{t("targetPortfolio")}</Label>
                      <PortfolioPicker
                        portfolios={portfolios}
                        value={portfolioByImport.get(iid) ?? portfolios[0]?.id ?? ""}
                        onChange={(pid) => onPortfolioChange(iid, pid)}
                        ariaLabel={t("targetPortfolio")}
                        triggerClassName="w-full"
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {matched
                      ? t("confirmPortfolio.matched")
                      : portfolios.length === 1
                        ? t("confirmPortfolio.onlyPortfolio")
                        : t("confirmPortfolio.choose")}
                  </p>
                  {issues.length > 0 && (
                    <p className="text-xs text-warning">
                      {t("review.issues.attention", { count: issues.length })}
                    </p>
                  )}
                </div>
              );
            })()
          )}
          <div className="flex items-center gap-2">
            <Button onClick={() => onMaterialize()} disabled={submitting}>
              {submitting && <Spinner size="sm" />}
              {t("confirmPortfolio.confirm")}
            </Button>
            <Button variant="ghost" onClick={onReset} disabled={submitting}>
              {t("confirmPortfolio.discard")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
