"use client";

import type { LucideIcon } from "lucide-react";
import { Upload, PenLine, Repeat, Briefcase, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/** The rail's destinations — a subset of `add-transaction-menu.tsx`'s own `Step` (it
 *  excludes "choose", the mobile-only chooser screen the rail has no equivalent of). */
export type DesktopStep = "import" | "manual" | "events" | "portfolio" | "holder";

interface NavItem {
  key: DesktopStep;
  label: string;
  icon: LucideIcon;
}

/**
 * The modal's 196px left destination rail, `max-md:hidden` — replaces the mobile
 * chooser screen and back button at `md:`+ (see `add-transaction-menu.tsx`). Order:
 * Import, Add transaction, a separator, then Instrument event, Create portfolio,
 * Account holder — matching the "Add Transaction v2" design 1:1.
 */
export function NavRail({
  active,
  onSelect,
  labels,
  className,
}: {
  /** The mobile-only "choose" step has no rail equivalent — pass it through as-is (no
   *  item matches, so nothing highlights) rather than forcing callers to remap it; the
   *  rail is `max-md:hidden` whenever "choose" is even reachable, so it's never visible
   *  in that state anyway. */
  active: DesktopStep | "choose";
  onSelect: (step: DesktopStep) => void;
  labels: {
    heading: string;
    import: string;
    manual: string;
    events: string;
    portfolio: string;
    holder: string;
  };
  /** #669: lets the merged single-tree overlay hide this at `max-md:` instead of the
   *  rail only ever mounting inside a desktop-only tree, as it does today. */
  className?: string;
}) {
  const top: NavItem[] = [
    { key: "import", label: labels.import, icon: Upload },
    { key: "manual", label: labels.manual, icon: PenLine },
  ];
  const bottom: NavItem[] = [
    { key: "events", label: labels.events, icon: Repeat },
    { key: "portfolio", label: labels.portfolio, icon: Briefcase },
    { key: "holder", label: labels.holder, icon: UserPlus },
  ];

  return (
    <aside
      className={cn(
        "flex w-[196px] shrink-0 flex-col gap-[3px] overflow-y-auto border-r border-border bg-card-2 p-3",
        className,
      )}
    >
      <div className="px-2.5 pb-3.5 pt-0.5 text-[17px] font-extrabold text-foreground">
        {labels.heading}
      </div>
      {top.map((item) => (
        <NavButton key={item.key} item={item} active={active === item.key} onSelect={onSelect} />
      ))}
      <hr className="mx-2.5 my-[9px] border-border" />
      {bottom.map((item) => (
        <NavButton key={item.key} item={item} active={active === item.key} onSelect={onSelect} />
      ))}
    </aside>
  );
}

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (step: DesktopStep) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      aria-current={active ? "step" : undefined}
      className={cn(
        "flex w-full items-center gap-[11px] rounded-[11px] px-3 py-2.5 text-left text-[13px]",
        active
          ? "bg-card font-bold text-foreground shadow-[0_1px_2px_rgba(15,27,20,.06)]"
          : "font-semibold text-text-2 hover:bg-card/60",
      )}
    >
      <Icon className="size-[19px] shrink-0" strokeWidth={1.9} />
      {item.label}
    </button>
  );
}
