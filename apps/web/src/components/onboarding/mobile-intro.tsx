"use client";

import { useEffect, useRef } from "react";
import { Icon, ICONS } from "./icon";
import { BrandLogo } from "./brand-logo";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export type MobileSlideKind = "card" | "glyph";

export interface MobileSlideCopy {
  h: string;
  s: string;
  kind: MobileSlideKind;
  bullets: string[];
}

// Glyph path per slide index 1–3 (slide 0 shows the net-worth card instead) —
// verbatim from the design's `mSlides()`; copy itself comes from `next-intl` via props.
const SLIDE_GLYPHS = [
  null,
  ICONS.mobileIntro.holders,
  ICONS.mobileIntro.tax,
  ICONS.mobileIntro.data,
];

const AUTO_ADVANCE_MS = 4600;

export interface MobileIntroCopy {
  skip: string;
  getStarted: string;
  haveAccount: string;
  netWorthLabel: string;
  netWorthValue: string;
  netWorthPill: string;
  slides: MobileSlideCopy[];
}

/** Full-screen branded intro overlay shown first on mobile (`isMobileIntro`), before
 *  the step flow. Auto-advances every 4.6s (paused once dismissed); dots, left/right
 *  tap zones, Skip and Get started all dismiss it into the step flow. */
export function MobileIntro({
  copy,
  slide,
  onGoToSlide,
  onEnter,
}: {
  copy: MobileIntroCopy;
  slide: number;
  onGoToSlide: (index: number) => void;
  onEnter: () => void;
}) {
  // Latest callback/slide in a ref so the interval effect only depends on `slide`
  // itself — re-arming (clearInterval + setInterval) exactly on a real slide change,
  // mirroring the design's `armM()`/`goM()`, not on unrelated parent re-renders.
  const onGoToSlideRef = useRef(onGoToSlide);
  useEffect(() => {
    onGoToSlideRef.current = onGoToSlide;
  });

  const tA = useTranslations("A11y");
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    // Auto-advancing slides are motion the user can't pause: with reduced motion they
    // advance only via the dots / tap zones / Get started.
    if (reducedMotion) return;
    const timer = setInterval(() => {
      onGoToSlideRef.current(slide + 1);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [slide, reducedMotion]);

  const slides = copy.slides;
  const cur = slides[slide];
  const curGlyph = SLIDE_GLYPHS[slide];

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-brand-intro px-7 pt-14 pb-8.5 text-white">
      <div className="pointer-events-none absolute -top-22.5 -right-27.5 size-80 animate-drift-glow-intro rounded-full bg-glow-primary opacity-34" />
      <div className="pointer-events-none absolute -bottom-35 -left-30 size-85 animate-drift-glow-intro-rev rounded-full bg-glow-mint opacity-12" />
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 400 844"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 animate-sway-intro"
        aria-hidden
      >
        <path
          d="M0,430 C55,375 110,455 165,365 C220,275 275,375 330,295 C365,240 400,275 400,245 L400,844 L0,844 Z"
          className="fill-white"
          fillOpacity=".06"
        />
        <path
          d="M0,520 C65,465 130,545 195,455 C260,365 315,445 370,365 C388,340 400,350 400,330 L400,844 L0,844 Z"
          className="fill-brand-mint"
          fillOpacity=".10"
        />
        <path
          d="M0,610 C65,560 130,630 195,550 C260,470 315,550 370,490 C388,465 400,480 400,450 L400,844 L0,844 Z"
          className="fill-primary"
          fillOpacity=".18"
        />
        <path
          d="M0,610 C65,560 130,630 195,550 C260,470 315,550 370,490 C388,465 400,480 400,450"
          fill="none"
          className="stroke-brand-mint"
          strokeWidth="2"
          strokeOpacity=".45"
        />
      </svg>

      <button
        type="button"
        onClick={() => onGoToSlide(slide - 1)}
        aria-label={tA("previous")}
        className="absolute top-30 bottom-52.5 left-0 z-[2] w-[40%] cursor-pointer border-none bg-transparent"
      />
      <button
        type="button"
        onClick={() => onGoToSlide(slide + 1)}
        aria-label={tA("next")}
        className="absolute top-30 right-0 bottom-52.5 z-[2] w-[40%] cursor-pointer border-none bg-transparent"
      />

      <div className="relative z-[3] flex items-center">
        <BrandLogo />
        <button
          type="button"
          onClick={onEnter}
          className="ml-auto cursor-pointer px-1 py-1.5 text-body-sm font-semibold text-white/60"
        >
          {copy.skip}
        </button>
      </div>

      <div key={`m-${slide}`} className="relative z-1 flex flex-1 flex-col animate-step-fade">
        {cur.kind === "card" && (
          <div className="mt-9.5">
            <div className="animate-floaty rounded-xl border border-white/14 bg-brand-card-glass px-5 py-4.5 shadow-float">
              <div className="flex items-start justify-between gap-2.5">
                <div>
                  <div className="text-micro font-semibold text-white/78">{copy.netWorthLabel}</div>
                  <div className="mt-1.25 text-2xl font-bold text-white tabular-nums">
                    {copy.netWorthValue}
                  </div>
                </div>
                <span className="rounded-full bg-white/20 px-2 py-1 text-micro font-bold whitespace-nowrap text-white">
                  {copy.netWorthPill}
                </span>
              </div>
              <svg
                viewBox="0 0 70 24"
                width="100%"
                height={34}
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
            </div>
          </div>
        )}
        {cur.kind === "glyph" && (
          <div className="mt-11 flex">
            <span className="flex size-19.5 animate-floaty items-center justify-center rounded-xl border border-white/16 bg-brand-card-glass shadow-float">
              {curGlyph && <Icon d={curGlyph} size={38} strokeWidth={1.9} className="text-white" />}
            </span>
          </div>
        )}
        <div className="mt-auto">
          <h1 className="text-3xl/[1.15] font-bold tracking-tight">{cur.h}</h1>
          <p className="mt-4 text-body text-white/66">{cur.s}</p>
          <div className="mt-5 flex flex-col gap-2.5">
            {cur.bullets.map((text, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="mt-2 size-1.25 shrink-0 rounded-full bg-brand-mint" />
                <span className="text-body-sm/normal text-white/74">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-[3] mt-6.5">
        <div className="mb-5 flex gap-1.75">
          {slides.map((_, k) => (
            <button
              key={k}
              type="button"
              onClick={() => onGoToSlide(k)}
              aria-label={tA("goToSlide", { n: k + 1 })}
              className={cn(
                "h-1.75 cursor-pointer rounded-full transition-[width,background-color] duration-250",
                k === slide ? "w-5.5 bg-brand-mint" : "w-1.75 bg-white/24",
              )}
            />
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onEnter}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary p-4 text-base font-bold text-primary-foreground shadow-cta-lg"
          >
            {copy.getStarted}
            <Icon d={ICONS.arrowRight} size={17} strokeWidth={2.2} />
          </button>
          {/* "I already have an account" has no handler in the source design (a dead
              button) — routed to the same dismiss-intro action since there's no
              separate sign-in surface inside onboarding (flagged as ambiguous). */}
          <button
            type="button"
            onClick={onEnter}
            className="w-full cursor-pointer p-1.5 text-sm font-bold text-white/82"
          >
            {copy.haveAccount}
          </button>
        </div>
      </div>
    </div>
  );
}
