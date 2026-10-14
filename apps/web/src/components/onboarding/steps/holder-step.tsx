import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FieldLabel, FieldError, GLASS_INPUT } from "./field";

export interface HolderCopy {
  nameLabel: string;
  namePlaceholder: string;
  birthYearLabel: string;
  birthYearPlaceholder: string;
  birthYearHelper: string;
}

export function HolderStep({
  copy,
  holderName,
  birthYear,
  holderNameError,
  birthYearError,
  onHolderNameChange,
  onBirthYearChange,
}: {
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
      <div className="mb-4">
        <FieldLabel>{copy.nameLabel}</FieldLabel>
        <Input
          className={cn(GLASS_INPUT, holderNameError && "border-destructive!")}
          aria-label={copy.nameLabel}
          placeholder={copy.namePlaceholder}
          value={holderName}
          onChange={(e) => onHolderNameChange(e.target.value)}
        />
        {holderNameError && <FieldError>{holderNameError}</FieldError>}
      </div>
      <div className="mb-4">
        <FieldLabel>{copy.birthYearLabel}</FieldLabel>
        <Input
          className={cn(GLASS_INPUT, birthYearError && "border-destructive!")}
          aria-label={copy.birthYearLabel}
          placeholder={copy.birthYearPlaceholder}
          inputMode="numeric"
          value={birthYear}
          onChange={(e) => onBirthYearChange(e.target.value)}
        />
        {birthYearError ? (
          <FieldError>{birthYearError}</FieldError>
        ) : (
          <p className="mx-0.5 mt-1.5 text-micro font-medium text-text-3">{copy.birthYearHelper}</p>
        )}
      </div>
    </>
  );
}
