"use client";

import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TypeChipPickerProps {
  type: string;
  typePickerOpen: boolean;
  typeGroups: { label: string; items: readonly string[] }[];
  onSelectType: (type: string) => void;
  onToggle: () => void;
  t: (key: string) => string;
  tt: (key: string) => string;
}

export function TypeChipPicker({
  type,
  typePickerOpen,
  typeGroups,
  onSelectType,
  onToggle,
  t,
  tt,
}: TypeChipPickerProps) {
  return (
    <div className="space-y-1.5">
      <Label>{t("type")}</Label>
      <button
        type="button"
        aria-label={t("type")}
        aria-expanded={typePickerOpen}
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-[13px] border border-border bg-card px-3.5 py-[13px] text-sm font-semibold text-foreground transition-colors focus-visible:border-primary focus-visible:outline-none"
      >
        <span>{tt(type)}</span>
        <ChevronDown
          className={cn("size-4 text-chevron transition-transform", typePickerOpen && "rotate-180")}
        />
      </button>
      {typePickerOpen && (
        <div className="mt-2.5 flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-[15px]">
          {typeGroups.map((g) => (
            <div key={g.label}>
              <p className="mb-2 ml-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-text-3">
                {g.label}
              </p>
              <div className="flex flex-wrap gap-[7px]">
                {g.items.map((ty) => (
                  <button
                    key={ty}
                    type="button"
                    onClick={() => onSelectType(ty)}
                    className={cn(
                      "rounded-[10px] px-[13px] py-[9px] text-[12px] transition-colors",
                      ty === type
                        ? "bg-primary font-bold text-primary-foreground"
                        : "border border-border bg-card-2 font-semibold text-foreground hover:bg-secondary",
                    )}
                  >
                    {tt(ty)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
