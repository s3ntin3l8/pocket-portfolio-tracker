"use client";

import { Input } from "@/components/ui/input";
import { SourceBadge } from "./source-badge";

/** A simple labeled text input with a source badge. */
export function Field({
  label,
  value,
  placeholder,
  source,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  source: "db" | "env";
  type?: "text" | "number";
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <label className="text-sm">{label}</label>
        <SourceBadge source={source} />
      </div>
      <Input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-sm"
      />
    </div>
  );
}
