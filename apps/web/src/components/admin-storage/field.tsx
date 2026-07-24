"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";

/** A labeled inset text input with a source badge (design: `bg-background` field inset
 *  into the storage card's `bg-card`). Only some fields are monospace in the design
 *  (folder path, access key) — plain fields (endpoint, region, bucket) aren't. */
export function Field({
  label,
  value,
  placeholder,
  source,
  type = "text",
  monospace = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  source: "db" | "env";
  type?: "text" | "number";
  monospace?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 px-0.5">
        <label className="text-xs font-semibold text-text-2">{label}</label>
        <SourceBadge source={source} />
      </div>
      <Input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "rounded-[12px] border-border bg-background text-sm",
          monospace && "font-mono",
        )}
      />
    </div>
  );
}
