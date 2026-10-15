"use client";

import { Suspense, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Portfolio } from "@portfolio/api-client";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useMediaQuery } from "@/lib/use-media-query";
import { ImportTasksProvider } from "@/components/import-tasks-provider";
import type { NewEntryTab } from "@/components/new-entry-tabs";
import {
  LazyImportFlowClient as ImportFlowClient,
  LazyNewEntryTabs as NewEntryTabs,
} from "@/components/add-transaction-menu/lazy-bodies";
import { Icon, ICONS } from "./icon";
import { BrandLogo } from "./brand-logo";
import { BrandPanel } from "./brand-panel";
import { MobileBackdrop } from "./mobile-backdrop";
import { MobileIntro } from "./mobile-intro";
import { ThemeTogglePill } from "./theme-toggle-pill";
import { WelcomeStep } from "./steps/welcome-step";
import { HolderStep } from "./steps/holder-step";
import { TaxStep } from "./steps/tax-step";
import { PortfolioStep } from "./steps/portfolio-step";
import { AddDataStep, type AddDataCardKey } from "./steps/add-data-step";
import { AddDataTrConnect } from "./steps/add-data-tr";
import { DoneStep } from "./steps/done-step";

const CURRENT_YEAR = new Date().getFullYear();

type AddDataView = "cards" | "tr";

interface FieldErrors {
  holderName?: string;
  birthYear?: string;
  portfolioName?: string;
}

/** Client-side onboarding flow — ported 1:1 from the `Onboarding.dc.html` design
 *  (see the plan for the full fidelity notes). This component owns the whole
 *  step machine, theme resolution, the mobile intro carousel, and the real API
 *  wiring for holder/portfolio creation and the add-data sub-flows. */
export function OnboardingFlow() {
  const t = useTranslations("Onboarding");
  const api = useApiClient();
  const router = useRouter();
  // Shared with the app-wide theme controls; defaults dark (matches the design's own default).

  // Desktop/mobile layout switch at the app-wide `md` breakpoint (768px) — the same one
  // every overlay uses. `useMediaQuery` reports `false` for the server render and
  // corrects to the real value on the client, so a phone never paints the desktop split
  // layout first (the old `useState(true)` + 900px resize listener did).
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [step, setStep] = useState(0);
  const [taxRegime, setTaxRegime] = useState<"DE" | "ID">("DE");
  const [currency, setCurrency] = useState("EUR");
  const [cashCounted, setCashCounted] = useState(false);
  const [brokerageValue, setBrokerageValue] = useState("");
  const [brokerageOpen, setBrokerageOpen] = useState(false);
  const [mIntroDone, setMIntroDone] = useState(false);
  const [mSlide, setMSlide] = useState(0);

  const [holderName, setHolderName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [portfolioName, setPortfolioName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const [creating, setCreating] = useState(false);
  const [createdHolderId, setCreatedHolderId] = useState<string | null>(null);
  const [createdPortfolio, setCreatedPortfolio] = useState<Portfolio | null>(null);
  const [addDataView, setAddDataView] = useState<AddDataView>("cards");
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTab, setManualTab] = useState<NewEntryTab>("transaction");
  const [exiting, setExiting] = useState(false);

  const isDone = step === 5;
  const showChrome = !isDone;
  // Verbatim `step > 0 && step < 5` from the design — this also covers the TR
  // connect sub-step (still step 4), where `handleBack` special-cases returning to
  // the add-data cards instead of stepping back to Portfolio.
  const showBack = step > 0 && step < 5;
  const showPrimaryCta = step < 4;

  const stepMetaByIndex = [
    t("steps.welcome.title"),
    t("steps.holder.title"),
    t("steps.tax.title"),
    t("steps.portfolio.title"),
    t("steps.addData.title"),
    "",
  ];
  const stepKickerByIndex = [
    t("steps.welcome.kicker"),
    t("steps.holder.kicker"),
    t("steps.tax.kicker"),
    t("steps.portfolio.kicker"),
    t("steps.addData.kicker"),
    "",
  ];
  const stepSubByIndex = [
    t("steps.welcome.sub"),
    t("steps.holder.sub"),
    t("steps.tax.sub"),
    t("steps.portfolio.sub"),
    t("steps.addData.sub"),
    "",
  ];

  const brandByIndex = [
    { h: t("brand.welcome.headline"), s: t("brand.welcome.sub") },
    { h: t("brand.holder.headline"), s: t("brand.holder.sub") },
    { h: t("brand.tax.headline"), s: t("brand.tax.sub") },
    { h: t("brand.portfolio.headline"), s: t("brand.portfolio.sub") },
    { h: t("brand.addData.headline"), s: t("brand.addData.sub") },
    { h: t("brand.done.headline"), s: t("brand.done.sub") },
  ];

  const brandBullets = useMemo(() => {
    switch (step) {
      case 0:
        return t.raw("brand.welcome.bullets") as string[];
      case 1:
        return t.raw("brand.holder.bullets") as string[];
      case 2:
        return [
          taxRegime === "DE" ? t("brand.tax.bulletDe") : t("brand.tax.bulletId"),
          t("brand.tax.bulletChange"),
        ];
      case 3:
        return [
          t("brand.portfolio.bulletCurrency"),
          cashCounted ? t("brand.portfolio.bulletCashIn") : t("brand.portfolio.bulletCashOut"),
          t("brand.portfolio.bulletBrokerage"),
        ];
      case 4:
        return t.raw("brand.addData.bullets") as string[];
      case 5:
        return [t("brand.done.bullet")];
      default:
        return [];
    }
  }, [step, taxRegime, cashCounted, t]);

  const primaryCtaLabel = [
    t("primaryCta.getStarted"),
    t("primaryCta.continue"),
    t("primaryCta.continue"),
    t("primaryCta.createPortfolio"),
    "",
    "",
  ][step];

  // The toggle's label is the *action* — the opposite of the current theme.

  const stepTitle = stepMetaByIndex[step];
  const brandContent = brandByIndex[step];

  function validateHolderStep(): boolean {
    const errs: FieldErrors = {};
    if (!holderName.trim()) errs.holderName = t("holder.nameRequired");
    if (birthYear.trim()) {
      const y = Number(birthYear);
      if (!Number.isInteger(y) || y < 1900 || y > CURRENT_YEAR) {
        errs.birthYear = t("holder.birthYearInvalid", { min: 1900, max: CURRENT_YEAR });
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validatePortfolioStep(): boolean {
    const errs: FieldErrors = {};
    if (!portfolioName.trim()) errs.portfolioName = t("portfolio.nameRequired");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function commitPortfolio() {
    setCreating(true);
    try {
      let holderId = createdHolderId;
      const holderInput = {
        name: holderName.trim(),
        birthYear: birthYear.trim() ? Number(birthYear) : null,
      };
      if (holderId) {
        await api.updateAccountHolder(holderId, holderInput);
      } else {
        const holder = await api.createAccountHolder({ ...holderInput, type: "self" });
        holderId = holder.id;
        setCreatedHolderId(holder.id);
      }
      await api.putPreferences({ taxRegime });
      const portfolioInput = {
        name: portfolioName.trim(),
        brokerage: brokerageValue.trim() || null,
        baseCurrency: currency,
        cashCounted,
        accountHolderId: holderId,
        allowNegativeCash: false,
        documentRetention: false,
      };
      const portfolio = createdPortfolio
        ? await api.updatePortfolio(createdPortfolio.id, portfolioInput)
        : await api.createPortfolio(portfolioInput);
      setCreatedPortfolio(portfolio);
      setStep(4);
    } catch {
      toast.error(t("portfolio.createError"));
    } finally {
      setCreating(false);
    }
  }

  function handlePrimaryCta() {
    if (creating) return;
    if (step === 1) {
      if (!validateHolderStep()) return;
      setStep(2);
      return;
    }
    if (step === 3) {
      if (!validatePortfolioStep()) return;
      void commitPortfolio();
      return;
    }
    setStep((s) => Math.min(s + 1, 5));
  }

  function handleBack() {
    if (step === 4 && addDataView !== "cards") {
      setAddDataView("cards");
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
  }

  async function completeOnboarding() {
    try {
      await api.completeOnboarding();
    } catch {
      // Best-effort: a failed flag-set just means the user may see onboarding again
      // next login — never block navigation on it.
    }
  }

  async function handleSkipSetup() {
    if (exiting) return;
    setExiting(true);
    await completeOnboarding();
    router.push("/holdings");
  }

  async function handleFinish() {
    if (exiting) return;
    setExiting(true);
    await completeOnboarding();
    router.push("/holdings");
  }

  function handleAddDataSelect(key: AddDataCardKey) {
    if (key === "connect") {
      setAddDataView("tr");
    } else if (key === "import") {
      setImportOpen(true);
    } else if (key === "manual") {
      // AddTransaction's own success handler navigates straight to /transactions,
      // bypassing our Done screen — mark onboarding complete now (a portfolio
      // already exists at this point, step 4) so landing there doesn't bounce back.
      void completeOnboarding();
      setManualOpen(true);
    } else {
      setStep(5);
    }
  }

  function goToSlide(index: number) {
    const n = 4;
    setMSlide(((index % n) + n) % n);
  }

  const isMobileIntro = !isDesktop && !mIntroDone;

  const targetPortfolios = createdPortfolio
    ? [
        {
          id: createdPortfolio.id,
          name: createdPortfolio.name,
          brokerage: createdPortfolio.brokerage,
          accountHolder: createdPortfolio.accountHolder,
        },
      ]
    : [];

  return (
    <ImportTasksProvider>
      <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-white md:flex-row dark:bg-background">
        {isDesktop && <ThemeTogglePill className="absolute top-5.5 right-5.5 z-5" />}

        {isDesktop && (
          <BrandPanel
            step={step}
            stepTitle={stepTitle}
            brandHeadline={brandContent.h}
            brandSub={brandContent.s}
            brandBullets={brandBullets}
          />
        )}

        <div className="relative flex min-w-0 flex-1 flex-col justify-start overflow-y-auto bg-white px-5 pt-6 pb-11 max-md:dark:bg-brand-panel md:flex-[1_1_56%] md:justify-center md:bg-onb-panel md:px-[6vw] md:py-12">
          {!isDesktop && <MobileBackdrop />}

          <div className="relative mx-auto w-full max-w-105">
            {!isDesktop && (
              <div className="mb-5.5 flex items-center">
                <BrandLogo size="sm" className="text-foreground" />
                <ThemeTogglePill className="ml-auto" />
              </div>
            )}

            {showChrome ? (
              <>
                <div className="mb-4.5 flex min-h-7 items-center justify-between">
                  {showBack ? (
                    <button
                      type="button"
                      onClick={handleBack}
                      className="touch-target relative flex cursor-pointer items-center gap-[5px] text-body-sm font-bold text-text-mute"
                    >
                      <Icon d={ICONS.back} size={15} strokeWidth={2.2} />
                      {t("back")}
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSkipSetup()}
                    disabled={exiting}
                    className="touch-target relative cursor-pointer text-body-sm font-semibold text-text-3"
                  >
                    {t("skipSetup")}
                  </button>
                </div>

                <div className="mb-6 flex gap-1.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.25 w-5.5 rounded-full transition-colors duration-200",
                        i <= step ? "bg-primary" : "bg-input",
                      )}
                    />
                  ))}
                </div>

                <div key={stepTitle} className="animate-step-in">
                  <div className="text-xs font-bold tracking-[0.14em] text-success uppercase">
                    {stepKickerByIndex[step]}
                  </div>
                  <h2 className="mt-2.5 mb-1.5 text-2xl font-extrabold tracking-tight text-foreground">
                    {stepTitle}
                  </h2>
                  <p className="mb-6.5 text-sm/relaxed font-medium text-text-2">
                    {stepSubByIndex[step]}
                  </p>

                  {step === 0 && (
                    <WelcomeStep
                      copy={{
                        previewLabel: t("welcome.previewLabel"),
                        previewValue: t("welcome.previewValue"),
                        previewPill: t("welcome.previewPill"),
                        previewCaption: t("welcome.previewCaption"),
                        tourSectionLabel: t("welcome.tourSectionLabel"),
                        tourItems: [
                          {
                            label: t("welcome.tour.holdings.label"),
                            desc: t("welcome.tour.holdings.desc"),
                          },
                          {
                            label: t("welcome.tour.activity.label"),
                            desc: t("welcome.tour.activity.desc"),
                          },
                          {
                            label: t("welcome.tour.reports.label"),
                            desc: t("welcome.tour.reports.desc"),
                          },
                          {
                            label: t("welcome.tour.insights.label"),
                            desc: t("welcome.tour.insights.desc"),
                          },
                          {
                            label: t("welcome.tour.profile.label"),
                            desc: t("welcome.tour.profile.desc"),
                          },
                        ],
                      }}
                    />
                  )}

                  {step === 1 && (
                    <HolderStep
                      copy={{
                        nameLabel: t("holder.nameLabel"),
                        namePlaceholder: t("holder.namePlaceholder"),
                        birthYearLabel: t("holder.birthYearLabel"),
                        birthYearPlaceholder: t("holder.birthYearPlaceholder"),
                        birthYearHelper: t("holder.birthYearHelper"),
                      }}
                      holderName={holderName}
                      birthYear={birthYear}
                      holderNameError={errors.holderName}
                      birthYearError={errors.birthYear}
                      onHolderNameChange={(v) => {
                        setHolderName(v);
                        setErrors((e) => ({ ...e, holderName: undefined }));
                      }}
                      onBirthYearChange={(v) => {
                        setBirthYear(v);
                        setErrors((e) => ({ ...e, birthYear: undefined }));
                      }}
                    />
                  )}

                  {step === 2 && (
                    <TaxStep
                      options={[
                        { code: "DE", name: t("tax.de.name"), desc: t("tax.de.desc") },
                        { code: "ID", name: t("tax.id.name"), desc: t("tax.id.desc") },
                      ]}
                      taxRegime={taxRegime}
                      onSelect={setTaxRegime}
                    />
                  )}

                  {step === 3 && (
                    <PortfolioStep
                      copy={{
                        nameLabel: t("portfolio.nameLabel"),
                        namePlaceholder: t("portfolio.namePlaceholder"),
                        brokerageLabel: t("portfolio.brokerageLabel"),
                        brokerageOptional: t("portfolio.brokerageOptional"),
                        brokeragePlaceholder: t("portfolio.brokeragePlaceholder"),
                        currencyLabel: t("portfolio.currencyLabel"),
                        cashLabel: t("portfolio.cashLabel"),
                        cashInvestOnly: t("portfolio.cashInvestOnly"),
                        cashInvestOnlyDesc: t("portfolio.cashInvestOnlyDesc"),
                        cashSavings: t("portfolio.cashSavings"),
                        cashSavingsDesc: t("portfolio.cashSavingsDesc"),
                        cashHelper: t("portfolio.cashHelper"),
                      }}
                      portfolioName={portfolioName}
                      portfolioNameError={errors.portfolioName}
                      onPortfolioNameChange={(v) => {
                        setPortfolioName(v);
                        setErrors((e) => ({ ...e, portfolioName: undefined }));
                      }}
                      brokerageValue={brokerageValue}
                      brokerageOpen={brokerageOpen}
                      onBrokerageChange={(v) => {
                        setBrokerageValue(v);
                        setBrokerageOpen(true);
                      }}
                      onBrokerageFocus={() => setBrokerageOpen(true)}
                      onBrokerageToggle={() => setBrokerageOpen((o) => !o)}
                      onBrokerageBlur={() => setTimeout(() => setBrokerageOpen(false), 120)}
                      onSelectBrokerage={(name) => {
                        setBrokerageValue(name);
                        setBrokerageOpen(false);
                      }}
                      currency={currency}
                      onCurrencyChange={setCurrency}
                      cashCounted={cashCounted}
                      onCashCountedChange={setCashCounted}
                    />
                  )}

                  {step === 4 && addDataView === "cards" && (
                    <AddDataStep
                      copy={{
                        connectTitle: t("addData.connectTitle"),
                        connectDesc: t("addData.connectDesc"),
                        importTitle: t("addData.importTitle"),
                        importDesc: t("addData.importDesc"),
                        manualTitle: t("addData.manualTitle"),
                        manualDesc: t("addData.manualDesc"),
                        skipTitle: t("addData.skipTitle"),
                        skipDesc: t("addData.skipDesc"),
                      }}
                      onSelect={handleAddDataSelect}
                    />
                  )}

                  {step === 4 && addDataView === "tr" && createdPortfolio && (
                    <AddDataTrConnect
                      api={api}
                      portfolioId={createdPortfolio.id}
                      cashCounted={cashCounted}
                      onConnected={() => setStep(5)}
                      loadingLabel={t("addData.trLoading")}
                      unavailableLabel={t("addData.trUnavailable")}
                    />
                  )}

                  {showPrimaryCta && (
                    <button
                      type="button"
                      onClick={handlePrimaryCta}
                      disabled={creating}
                      className={cn(
                        "mt-2 flex w-full items-center justify-center gap-[7px] rounded-lg bg-primary p-[15px] text-body font-bold text-white shadow-cta",
                        creating ? "cursor-default opacity-70" : "cursor-pointer",
                      )}
                    >
                      {creating ? <Spinner size="sm" /> : primaryCtaLabel}
                      {!creating && <Icon d={ICONS.arrowRight} size={16} strokeWidth={2.2} />}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <DoneStep
                copy={{
                  heading: t("done.heading"),
                  readySub: t("done.readySub"),
                  skippedSub: t("done.skippedSub"),
                  cta: t("done.cta"),
                }}
                portfolioCreated={createdPortfolio !== null}
                onFinish={() => void handleFinish()}
              />
            )}
          </div>
        </div>

        {isMobileIntro && (
          <MobileIntro
            copy={{
              skip: t("mobileIntro.skip"),
              getStarted: t("mobileIntro.getStarted"),
              haveAccount: t("mobileIntro.haveAccount"),
              netWorthLabel: t("mobileIntro.netWorthLabel"),
              netWorthValue: t("mobileIntro.netWorthValue"),
              netWorthPill: t("mobileIntro.netWorthPill"),
              slides: [
                {
                  h: t("mobileIntro.slide1.headline"),
                  s: t("mobileIntro.slide1.sub"),
                  kind: "card",
                  bullets: t.raw("mobileIntro.slide1.bullets") as string[],
                },
                {
                  h: t("mobileIntro.slide2.headline"),
                  s: t("mobileIntro.slide2.sub"),
                  kind: "glyph",
                  bullets: t.raw("mobileIntro.slide2.bullets") as string[],
                },
                {
                  h: t("mobileIntro.slide3.headline"),
                  s: t("mobileIntro.slide3.sub"),
                  kind: "glyph",
                  bullets: t.raw("mobileIntro.slide3.bullets") as string[],
                },
                {
                  h: t("mobileIntro.slide4.headline"),
                  s: t("mobileIntro.slide4.sub"),
                  kind: "glyph",
                  bullets: t.raw("mobileIntro.slide4.bullets") as string[],
                },
              ],
            }}
            slide={mSlide}
            onGoToSlide={goToSlide}
            onEnter={() => setMIntroDone(true)}
          />
        )}
      </div>

      {/* "Import a CSV or screenshot" — reuses the real import flow (same component the
          app-wide Add-transaction sheet uses), scoped to the portfolio just created. */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent size="lg" mobileHeader={{ title: t("addData.importSheetTitle") }}>
          <div className="p-5 md:p-6">
            <DialogTitle className="hidden text-xl font-extrabold md:mb-3 md:block">
              {t("addData.importSheetTitle")}
            </DialogTitle>
            {importOpen && createdPortfolio && (
              <Suspense fallback={null}>
                <ImportFlowClient
                  portfolios={targetPortfolios}
                  defaultPortfolioId={createdPortfolio.id}
                  onClose={() => {
                    setImportOpen(false);
                    setStep(5);
                  }}
                />
              </Suspense>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* "Add manually" — reuses the real manual-entry tabs (same component the
          app-wide Add-transaction sheet uses). Onboarding is marked complete the
          moment this opens (see handleAddDataSelect) since a successful save here
          navigates straight to /transactions on its own. */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent
          size="lg"
          mobileHeader={{ title: t("addData.manualSheetTitle") }}
          footer={true}
        >
          <div className="p-5 md:p-6">
            <DialogTitle className="hidden text-xl font-extrabold md:mb-3 md:block">
              {t("addData.manualSheetTitle")}
            </DialogTitle>
            {manualOpen && createdPortfolio && (
              <NewEntryTabs
                portfolios={targetPortfolios}
                initialPortfolioId={createdPortfolio.id}
                value={manualTab}
                onValueChange={setManualTab}
                stickyFooter
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ImportTasksProvider>
  );
}
