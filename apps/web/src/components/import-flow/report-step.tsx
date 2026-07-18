"use client";

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PortfolioPicker } from "@/components/portfolio-picker";
import type { ImportTargetPortfolio } from "./types";

export interface ReportStepProps {
  reportMeta: { category: string; taxYear: number | null; title: string } | null;
  portfolios: ImportTargetPortfolio[];
  reportPortfolioId: string;
  onReportPortfolioChange: (id: string) => void;
  savingReport: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function ReportStep({
  reportMeta,
  portfolios,
  reportPortfolioId,
  onReportPortfolioChange,
  savingReport,
  onSave,
  onCancel,
}: ReportStepProps) {
  const t = useTranslations("Import");

  if (!reportMeta) return null;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
          <FileText className="size-6 text-primary" />
        </span>
        <div>
          <p className="font-medium">{t("report.detected", { title: reportMeta.title })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("report.hint")}</p>
        </div>
        {portfolios.length > 1 && (
          <div className="w-full max-w-xs space-y-1.5 text-left">
            <Label>{t("report.portfolioPicker")}</Label>
            <PortfolioPicker
              portfolios={portfolios}
              value={reportPortfolioId}
              onChange={onReportPortfolioChange}
              ariaLabel={t("report.portfolioPicker")}
              triggerClassName="w-full"
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={savingReport} onClick={onCancel}>
            {t("report.cancel")}
          </Button>
          <Button type="button" disabled={savingReport || !reportPortfolioId} onClick={onSave}>
            {savingReport ? <Spinner size="sm" /> : null}
            {t("report.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
