import { Icon, ICONS } from "../icon";

export interface DoneCopy {
  heading: string;
  readySub: string;
  skippedSub: string;
  cta: string;
}

/** Step 5 — Done. Copy is skip-aware: if the user skipped portfolio creation
 *  ("Skip setup" before step 3), it must not claim "Your portfolio is ready" — see
 *  `portfolioCreated`. */
export function DoneStep({
  copy,
  portfolioCreated,
  onFinish,
}: {
  copy: DoneCopy;
  portfolioCreated: boolean;
  onFinish: () => void;
}) {
  return (
    <div className="flex min-h-105 animate-step-in flex-col items-center justify-center text-center">
      <span className="flex size-15.5 items-center justify-center rounded-full bg-primary shadow-done-badge">
        <Icon d={ICONS.check} size={30} strokeWidth={2.6} className="text-white" />
      </span>
      <h2 className="mt-6 mb-2 text-2xl font-extrabold text-foreground">{copy.heading}</h2>
      <p className="m-0 max-w-70 text-sm font-medium text-text-2">
        {portfolioCreated ? copy.readySub : copy.skippedSub}
      </p>
      <button
        type="button"
        onClick={onFinish}
        className="mt-6.5 inline-flex cursor-pointer items-center gap-[7px] rounded-md bg-primary px-6 py-3 text-sm font-bold text-white shadow-cta"
      >
        {copy.cta}
        <Icon d={ICONS.arrowRight} size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}
