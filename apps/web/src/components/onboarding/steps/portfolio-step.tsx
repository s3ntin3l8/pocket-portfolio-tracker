import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Icon, ICONS } from "../icon";
import { choiceCardClass } from "../choice-card";
import { FieldLabel, FieldError, GLASS_INPUT } from "./field";

const BROKERAGE_LIST = [
  "Trade Republic",
  "Interactive Brokers",
  "DKB",
  "Coinbase",
  "Degiro",
  "Scalable Capital",
  "Bitpanda",
];

const CURRENCY_OPTIONS = ["IDR", "USD", "EUR", "SGD"];

export interface PortfolioCopy {
  nameLabel: string;
  namePlaceholder: string;
  brokerageLabel: string;
  brokerageOptional: string;
  brokeragePlaceholder: string;
  currencyLabel: string;
  cashLabel: string;
  cashInvestOnly: string;
  cashInvestOnlyDesc: string;
  cashSavings: string;
  cashSavingsDesc: string;
  cashHelper: string;
}

export function PortfolioStep({
  copy,
  portfolioName,
  portfolioNameError,
  onPortfolioNameChange,
  brokerageValue,
  brokerageOpen,
  onBrokerageChange,
  onBrokerageFocus,
  onBrokerageToggle,
  onBrokerageBlur,
  onSelectBrokerage,
  currency,
  onCurrencyChange,
  cashCounted,
  onCashCountedChange,
}: {
  copy: PortfolioCopy;
  portfolioName: string;
  portfolioNameError?: string;
  onPortfolioNameChange: (value: string) => void;
  brokerageValue: string;
  brokerageOpen: boolean;
  onBrokerageChange: (value: string) => void;
  onBrokerageFocus: () => void;
  onBrokerageToggle: () => void;
  onBrokerageBlur: () => void;
  onSelectBrokerage: (name: string) => void;
  currency: string;
  onCurrencyChange: (code: string) => void;
  cashCounted: boolean;
  onCashCountedChange: (value: boolean) => void;
}) {
  const cashOptions = [
    { key: false as const, title: copy.cashInvestOnly, desc: copy.cashInvestOnlyDesc },
    { key: true as const, title: copy.cashSavings, desc: copy.cashSavingsDesc },
  ];
  const q = brokerageValue.trim().toLowerCase();
  const matches = BROKERAGE_LIST.filter((name) => !q || name.toLowerCase().includes(q));

  return (
    <>
      <div className="mb-4.5">
        <FieldLabel>{copy.nameLabel}</FieldLabel>
        <Input
          className={cn(GLASS_INPUT, portfolioNameError && "border-destructive!")}
          aria-label={copy.nameLabel}
          placeholder={copy.namePlaceholder}
          value={portfolioName}
          onChange={(e) => onPortfolioNameChange(e.target.value)}
        />
        {portfolioNameError && <FieldError>{portfolioNameError}</FieldError>}
      </div>

      <div className="relative mb-4.5">
        <FieldLabel>
          {copy.brokerageLabel}{" "}
          <span className="font-medium text-text-3">{copy.brokerageOptional}</span>
        </FieldLabel>
        <div className="relative">
          <Input
            className={cn(GLASS_INPUT, "pr-10")}
            aria-label={copy.brokerageLabel}
            placeholder={copy.brokeragePlaceholder}
            value={brokerageValue}
            onChange={(e) => onBrokerageChange(e.target.value)}
            onFocus={onBrokerageFocus}
            onBlur={onBrokerageBlur}
          />
          <button
            type="button"
            aria-label={copy.brokerageLabel}
            aria-expanded={brokerageOpen}
            onClick={onBrokerageToggle}
            className="absolute top-0 right-0 flex h-full w-10 cursor-pointer items-center justify-center text-text-3"
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("transition-transform duration-150", brokerageOpen && "rotate-180")}
              aria-hidden
            >
              <path d={ICONS.chevronDown} />
            </svg>
          </button>
        </div>
        {brokerageOpen && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-10 max-h-56 overflow-y-auto rounded-md border border-border bg-onb-panel p-1.5 shadow-onb-menu">
            {matches.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectBrokerage(name);
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-xs bg-muted">
                  <Icon d={ICONS.building} size={14} className="text-success" />
                </span>
                <span className="text-body-sm font-semibold text-foreground">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5.5">
        <FieldLabel className="mb-2">{copy.currencyLabel}</FieldLabel>
        <div className="flex gap-1.75">
          {CURRENCY_OPTIONS.map((code) => {
            const selected = code === currency;
            return (
              <button
                key={code}
                type="button"
                onClick={() => onCurrencyChange(code)}
                className={cn(
                  "cursor-pointer rounded-sm px-3.5 py-2 text-xs font-bold transition-colors",
                  selected ? "bg-primary text-white" : "bg-muted text-text-mute dark:text-text-2",
                )}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-2">
        <FieldLabel className="mb-2">{copy.cashLabel}</FieldLabel>
        <div className="flex flex-col gap-2.5">
          {cashOptions.map((o) => {
            const selected = o.key === cashCounted;
            return (
              <button
                key={String(o.key)}
                type="button"
                onClick={() => onCashCountedChange(o.key)}
                className={choiceCardClass(selected)}
              >
                <div className="flex items-center justify-between gap-2.5">
                  <span className="text-sm font-bold text-foreground">{o.title}</span>
                  {selected && (
                    <Icon d={ICONS.check} size={17} strokeWidth={2.4} className="text-primary" />
                  )}
                </div>
                <p className="mt-1.5 text-xs/normal font-medium text-text-2">{o.desc}</p>
              </button>
            );
          })}
        </div>
        <p className="mx-0.5 mt-2.5 text-micro font-medium text-text-3">{copy.cashHelper}</p>
      </div>
    </>
  );
}
