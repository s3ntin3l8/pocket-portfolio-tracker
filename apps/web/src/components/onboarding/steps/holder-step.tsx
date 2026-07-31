import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OnboardingTheme } from "../theme";
import styles from "../onboarding.module.css";

export interface HolderCopy {
  nameLabel: string;
  namePlaceholder: string;
  birthYearLabel: string;
  birthYearPlaceholder: string;
  birthYearHelper: string;
}

export function HolderStep({
  th,
  copy,
  holderName,
  birthYear,
  holderNameError,
  birthYearError,
  onHolderNameChange,
  onBirthYearChange,
}: {
  th: OnboardingTheme;
  copy: HolderCopy;
  holderName: string;
  birthYear: string;
  holderNameError?: string;
  birthYearError?: string;
  onHolderNameChange: (value: string) => void;
  onBirthYearChange: (value: string) => void;
}) {
  return (
    <>
      <div style={{ marginBottom: 15 }}>
        <label
          style={{
            display: "block",
            font: "600 12px 'Plus Jakarta Sans'",
            color: th.labelColor,
            margin: "0 2px 6px",
          }}
        >
          {copy.nameLabel}
        </label>
        <Input
          className={cn(
            th.glassInput && "bg-white/5 backdrop-blur-[3px] border-white/14",
            holderNameError && styles.inputError,
          )}
          placeholder={copy.namePlaceholder}
          value={holderName}
          onChange={(e) => onHolderNameChange(e.target.value)}
        />
        {holderNameError && <p className={styles.errorText}>{holderNameError}</p>}
      </div>
      <div style={{ marginBottom: 15 }}>
        <label
          style={{
            display: "block",
            font: "600 12px 'Plus Jakarta Sans'",
            color: th.labelColor,
            margin: "0 2px 6px",
          }}
        >
          {copy.birthYearLabel}
        </label>
        <Input
          className={cn(
            th.glassInput && "bg-white/5 backdrop-blur-[3px] border-white/14",
            birthYearError && styles.inputError,
          )}
          placeholder={copy.birthYearPlaceholder}
          inputMode="numeric"
          value={birthYear}
          onChange={(e) => onBirthYearChange(e.target.value)}
        />
        {birthYearError ? (
          <p className={styles.errorText}>{birthYearError}</p>
        ) : (
          <p
            style={{
              font: "500 11.5px 'Plus Jakarta Sans'",
              color: th.dividerText,
              margin: "6px 2px 0",
            }}
          >
            {copy.birthYearHelper}
          </p>
        )}
      </div>
    </>
  );
}
