"use client";

import { Info, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { GainSummary } from "@portfolio/api-client";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatNetWorth } from "@/lib/utils";

const FIELDS = [
  { key: "value", label: "fieldValue", def: "fieldValueDef" },
  { key: "costOfOpen", label: "fieldCostOfOpen", def: "fieldCostOfOpenDef" },
  { key: "netContributed", label: "fieldNetContributed", def: "fieldNetContributedDef" },
  { key: "unrealized", label: "fieldUnrealized", def: "fieldUnrealizedDef" },
  { key: "realized", label: "fieldRealized", def: "fieldRealizedDef" },
  { key: "income", label: "fieldIncome", def: "fieldIncomeDef" },
] as const;

/**
 * The "how is this gain calculated?" explainer opened from both headline gain figures
 * (Holdings rail, Savings stats; audit G2). One `DialogContent` tree at every width — the
 * `Dialog` is a small blocking-info card, not a task flow, so it stays a centered card
 * instead of taking the screen on mobile. Lists every {@link GainSummary} field with this
 * scope's amount and a one-line definition.
 */
export function GainExplainer({ gain }: { gain: GainSummary }) {
  const t = useTranslations("Gain");
  const tAssistant = useTranslations("Assistant");
  const assistant = useAssistant();
  const locale = useLocale();
  const boundaryNote =
    gain.boundary === "inside"
      ? t("boundaryInside")
      : gain.boundary === "outside"
        ? t("boundaryOutside")
        : t("boundaryMixed");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-6 items-center gap-1 text-micro font-semibold text-text-2 underline-offset-2 hover:text-foreground hover:underline"
        >
          <Info className="size-3.5" aria-hidden />
          {t("explainerTrigger")}
        </button>
      </DialogTrigger>
      <DialogContent size="md" fullScreenOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{t("explainerTitle")}</DialogTitle>
          <DialogDescription>{t("explainerIntro")}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm font-bold">{t(f.label)}</dt>
                <dd className="tabular text-sm font-bold">
                  {formatNetWorth(gain[f.key], gain.displayCurrency, locale)}
                </dd>
              </div>
              <p className="mt-0.5 text-xs text-text-2">{t(f.def)}</p>
            </div>
          ))}
        </dl>
        <p className="text-xs text-text-2">{t("holdingsGainLine")}</p>
        <p className="text-xs text-text-2">{t("savingsGainLine")}</p>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-text-2">{boundaryNote}</p>
        {assistant.available && (
          // Closes this explainer, then hands the question to the assistant panel.
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => assistant.open(tAssistant("explainGainPrompt"))}
            >
              <Sparkles />
              {tAssistant("explainGain")}
            </Button>
          </DialogClose>
        )}
      </DialogContent>
    </Dialog>
  );
}
