"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import { tint } from "@/lib/tint";

export const TONES = {
  green: { ...tint("primary") },
  violet: { ...tint("violet") },
  gold: { ...tint("gold") },
  blue: { ...tint("info") },
  orange: { ...tint("orange") },
} as const;

export const MethodCard = forwardRef<
  HTMLButtonElement,
  {
    icon: LucideIcon;
    title: string;
    description: string;
    tone: keyof typeof TONES;
    tag?: string;
    onClick?: () => void;
  }
>(function MethodCard({ icon: Icon, title, description, tone, tag, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-xl border border-border bg-card p-4 text-left shadow-hairline transition-transform active:scale-[.97]"
    >
      <span
        className="flex size-[46px] shrink-0 items-center justify-center rounded-lg"
        style={{ background: TONES[tone].bg, color: TONES[tone].fg }}
      >
        <Icon className="size-[23px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-bold">{title}</span>
        <span className="mt-[3px] block text-xs font-medium leading-[1.4] text-text-2">
          {description}
        </span>
      </span>
      {tag && (
        <span className="shrink-0 rounded-xs bg-primary/15 px-2 py-1 text-micro font-bold text-primary-strong">
          {tag}
        </span>
      )}
    </button>
  );
});
