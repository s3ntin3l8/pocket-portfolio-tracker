import { BrandLogo } from "./brand-logo";
import { StepBackground, BG_SEQUENCE } from "./brand-backgrounds";

/** Desktop-only left brand panel: logo, per-step animated background, and the
 *  headline/subcopy/bullets block that syncs to the current step. */
export function BrandPanel({
  step,
  stepTitle,
  brandHeadline,
  brandSub,
  brandBullets,
}: {
  step: number;
  stepTitle: string;
  brandHeadline: string;
  brandSub: string;
  brandBullets: string[];
}) {
  return (
    <div className="relative flex min-w-0 flex-[1_1_44%] flex-col overflow-hidden bg-brand-panel px-15 py-14 text-white">
      <div className="pointer-events-none absolute -top-30 -right-35 size-110 animate-drift-glow rounded-full bg-glow-primary opacity-28" />
      <div className="pointer-events-none absolute -bottom-40 -left-30 size-105 animate-drift-glow-rev rounded-full bg-glow-mint opacity-10" />

      {/* rotating background, faded in per step — remounted (key) so the
          fade-in + sway animation restarts on every step change */}
      <div
        key={stepTitle}
        className="pointer-events-none absolute inset-0 origin-bottom animate-sway-brand"
      >
        <StepBackground variant={BG_SEQUENCE[step]} />
      </div>

      <BrandLogo className="relative" />

      <div className="relative mt-auto max-w-105">
        <div key={stepTitle} className="animate-step-in">
          <h1 className="text-display font-bold tracking-tight xl:text-hero">{brandHeadline}</h1>
          <p className="mt-4 text-body text-white/62">{brandSub}</p>
          <div className="mt-5.5 flex flex-col gap-2">
            {brandBullets.map((text, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-1.75 size-1.25 shrink-0 rounded-full bg-brand-mint" />
                <span className="text-xs/normal text-white/72">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
