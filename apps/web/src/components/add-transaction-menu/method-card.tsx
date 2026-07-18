"use client";

import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";

export const TONES = {
  green: { bg: "rgba(16,163,114,.14)", fg: "#0E9F6E" },
  violet: { bg: "rgba(124,92,252,.16)", fg: "#7C5CFC" },
  gold: { bg: "rgba(224,165,58,.16)", fg: "var(--gold-fg)" },
  blue: { bg: "rgba(59,130,246,.16)", fg: "#3B82F6" },
  orange: { bg: "rgba(249,115,22,.16)", fg: "#F97316" },
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
      className="flex w-full items-center gap-3.5 rounded-[18px] border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(15,27,20,.04)] transition-transform active:scale-[.97]"
    >
      <span
        className="flex size-[46px] shrink-0 items-center justify-center rounded-[14px]"
        style={{ background: TONES[tone].bg, color: TONES[tone].fg }}
      >
        <Icon className="size-[23px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="mt-[3px] block text-xs font-medium leading-[1.4] text-text-2">
          {description}
        </span>
      </span>
      {tag && (
        <span className="shrink-0 rounded-[7px] bg-[rgba(16,163,114,.14)] px-2 py-1 text-[9px] font-bold text-[#0E9F6E]">
          {tag}
        </span>
      )}
    </button>
  );
});
