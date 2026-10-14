import { cn } from "@/lib/utils";
import { Icon, ICONS } from "./icon";

/** The onboarding flow's own theme toggle pill (distinct from the app-wide
 *  `theme-toggle.tsx`, rendered both fixed-desktop and inline-mobile). */
export function ThemeTogglePill({
  isDark,
  label,
  onToggle,
  className,
}: {
  isDark: boolean;
  /** The action label — i.e. the opposite of the current theme ("Light" while dark,
   *  "Dark" while light). Passed in already-translated so this component stays
   *  i18n-agnostic. */
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex cursor-pointer items-center gap-[7px] rounded-full border border-input bg-muted px-3 py-2 text-xs font-bold text-text-mute",
        className,
      )}
    >
      {!isDark && <Icon d={ICONS.sun} size={15} />}
      {isDark && (
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path d={ICONS.moonPath} />
        </svg>
      )}
      {label}
    </button>
  );
}
