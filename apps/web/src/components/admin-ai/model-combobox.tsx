"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown } from "lucide-react";
import type { AdminAiModel } from "@portfolio/api-client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * A model dropdown that never traps the admin: it lists what the provider's API offers, always
 * keeps the saved model selectable (even when the list failed or no longer includes it), and
 * accepts any typed model id.
 */
export function ModelCombobox({
  value,
  onChange,
  models,
  loading,
  failed,
  capability,
  disabled,
  label,
}: {
  value: string;
  onChange: (model: string) => void;
  models: AdminAiModel[];
  loading: boolean;
  /** The provider's list could not be loaded: typing a model id is the only way. */
  failed: boolean;
  /** The capability this task needs; a model whose API doesn't state it is marked unverified. */
  capability: "vision" | "tools";
  disabled?: boolean;
  label: string;
}) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelId = useId();
  const listId = useId();

  const q = query.trim();
  const items =
    value && !models.some((m) => m.id === value)
      ? [{ id: value, label: value, vision: null, tools: null }, ...models]
      : models;
  const offerCustom = q !== "" && !items.some((m) => m.id === q);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-labelledby={labelId}
          disabled={disabled}
          className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3.5 text-left text-base font-medium transition-colors focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
        >
          <span className={cn("truncate", !value && "font-normal text-muted-foreground")}>
            {value || t("aiModelPlaceholder")}
          </span>
          {loading ? (
            <Spinner size="sm" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-text-2" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("aiModelSearch")}
            aria-label={t("aiModelSearch")}
          />
          <CommandList id={listId}>
            {failed && <p className="px-3 py-2 text-xs text-warning">{t("aiModelsFailed")}</p>}
            {!offerCustom && <CommandEmpty>{t("aiModelNone")}</CommandEmpty>}
            <CommandGroup>
              {items.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.id} ${m.label}`}
                  onSelect={() => pick(m.id)}
                  className="items-start"
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      m.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.label}</span>
                    {m.label !== m.id && (
                      <span className="block truncate font-mono text-micro text-muted-foreground">
                        {m.id}
                      </span>
                    )}
                  </span>
                  {m[capability] === null && !failed && (
                    <span className="shrink-0 text-micro text-muted-foreground">
                      {t("aiModelUnverified")}
                    </span>
                  )}
                </CommandItem>
              ))}
              {offerCustom && (
                <CommandItem forceMount value={`__custom__ ${q}`} onSelect={() => pick(q)}>
                  {t("aiModelUse", { model: q })}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
