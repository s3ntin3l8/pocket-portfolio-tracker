"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Instrument } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A reusable search-and-select picker for one instrument. */
export function InstrumentPicker({
  label,
  placeholder,
  selected,
  onSelect,
  search,
}: {
  label: string;
  placeholder: string;
  selected: Instrument | null;
  onSelect: (i: Instrument | null) => void;
  search: (q: string) => Promise<Instrument[]>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);

  async function runSearch(q: string) {
    setQuery(q);
    onSelect(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      setResults(await search(q.trim()));
    } catch {
      setResults([]);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {selected ? (
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{selected.symbol}</span>
            <span className="ml-2 text-muted-foreground">{selected.name}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={placeholder}
            onClick={() => onSelect(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
          />
          {results.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {results.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(i);
                      setResults([]);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{i.symbol}</span>
                    <span className="text-muted-foreground">{i.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
