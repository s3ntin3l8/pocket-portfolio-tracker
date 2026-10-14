import { Icon, ICONS } from "../icon";

const TOUR_ICONS = [
  ICONS.tour.holdings,
  ICONS.tour.activity,
  ICONS.tour.reports,
  ICONS.tour.insights,
  ICONS.tour.profile,
];

export interface WelcomeCopy {
  previewLabel: string;
  previewValue: string;
  previewPill: string;
  previewCaption: string;
  tourSectionLabel: string;
  /** One entry per `TOUR_ICONS`, in order (holdings/activity/reports/insights/profile). */
  tourItems: { label: string; desc: string }[];
}

/** Step 0 — Welcome + "what you'll find inside" tour. Static preview card + 5 tour rows. */
export function WelcomeStep({ copy }: { copy: WelcomeCopy }) {
  return (
    <>
      <div className="mb-5.5 rounded-xl bg-brand-card px-5 py-4.5 shadow-brand-card">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <div className="text-micro font-semibold text-white/78">{copy.previewLabel}</div>
            <div className="mt-1.25 text-heading font-extrabold whitespace-nowrap text-white tabular-nums">
              {copy.previewValue}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white/18 px-2 py-1 text-micro font-bold whitespace-nowrap text-white">
            {copy.previewPill}
          </span>
        </div>
        <svg
          viewBox="0 0 70 24"
          width="100%"
          height={30}
          preserveAspectRatio="none"
          className="mt-3.5 block"
          aria-hidden
        >
          <polyline
            points="0,20 10,16 20,18 30,10 40,13 50,6 60,9 70,2"
            fill="none"
            className="stroke-white"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="mt-2.5 text-micro font-medium text-white/55">{copy.previewCaption}</div>
      </div>
      <div className="mb-3 text-micro font-bold tracking-widest text-text-3 uppercase">
        {copy.tourSectionLabel}
      </div>
      <div className="mb-6.5 flex flex-col gap-1">
        {copy.tourItems.map((t, i) => (
          <div key={t.label} className="flex items-start gap-3 px-1 py-2.5">
            <span className="flex size-8.5 shrink-0 items-center justify-center rounded-sm bg-muted">
              <Icon d={TOUR_ICONS[i]} size={17} className="text-success" />
            </span>
            <div>
              <div className="text-sm font-bold text-foreground">{t.label}</div>
              <div className="mt-px text-xs/snug font-medium text-text-2">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
