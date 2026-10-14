/** Static ambient brand backdrop behind the mobile content panel — shown once the intro
 *  carousel is dismissed. Light/dark differences are pure CSS (`dark:` variants), so it
 *  needs no theme prop. No animation here (only the intro overlay's wave sways). */
export function MobileBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-[70px] -right-[90px] size-70 rounded-full bg-glow-primary opacity-12 dark:opacity-40" />
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 400 800"
        preserveAspectRatio="none"
        className="absolute inset-0"
        aria-hidden
      >
        <path
          d="M0,420 C55,370 110,450 165,360 C220,270 275,370 330,290 C365,235 400,270 400,240 L400,800 L0,800 Z"
          className="fill-primary opacity-[0.04] dark:fill-white dark:opacity-[0.05]"
        />
        <path
          d="M0,500 C65,450 130,530 195,440 C260,350 315,430 370,350 C388,325 400,335 400,315 L400,800 L0,800 Z"
          className="fill-primary opacity-[0.06] dark:fill-brand-mint dark:opacity-[0.08]"
        />
        <path
          d="M0,590 C65,540 130,610 195,530 C260,450 315,530 370,470 C388,445 400,460 400,430"
          fill="none"
          strokeWidth={1.6}
          className="stroke-primary opacity-[0.16] dark:stroke-brand-mint dark:opacity-[0.35]"
        />
      </svg>
    </div>
  );
}
