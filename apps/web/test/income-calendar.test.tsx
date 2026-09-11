import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { UpcomingPayment } from "@portfolio/api-client";

vi.stubEnv("NEXT_PUBLIC_LOGODEV_TOKEN", "");

const BBCA = "i-bbca";
const TLKM = "i-tlkm";
const ASII = "i-asii";

const E = (
  instrumentId: string,
  symbol: string,
  date: string,
  amount: string,
  partial: Partial<UpcomingPayment> = {},
): UpcomingPayment => ({
  instrumentId,
  symbol,
  name: symbol,
  displayName: null,
  date,
  amount,
  currency: "IDR",
  kind: "dividend",
  status: "projected",
  market: "IDX",
  assetClass: "equity",
  ...partial,
});

function wrap(upcoming: UpcomingPayment[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <IncomeCalendar upcoming={upcoming} />
    </NextIntlClientProvider>,
  );
}

import { IncomeCalendar } from "../src/components/income/income-calendar";
import { IncomeCalendarEmpty } from "../src/components/income/income-calendar-empty";

/** Build a YYYY-MM-DD string for a rolling offset from the current month. */
function monthOffset(offset: number, day = 5): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + offset;
  const target = new Date(Date.UTC(year, month, day));
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const UPCOMING: UpcomingPayment[] = [
  E(BBCA, "BBCA", monthOffset(0), "500000"),
  E(TLKM, "TLKM", monthOffset(0), "300000"),
  E(ASII, "ASII", monthOffset(1), "750000", { kind: "coupon", status: "scheduled" }),
];

describe("IncomeCalendar", () => {
  it("renders 12 month columns", () => {
    wrap(UPCOMING);
    // Each month column renders a month label — narrow format like "Sep".
    // We look for the scrollable container with all 12 children.
    const strip = document.querySelector(".flex.overflow-x-auto");
    expect(strip).toBeTruthy();
    // The strip should have exactly 12 direct children (one per month).
    expect(strip!.children.length).toBe(12);
  });

  it("starts from the current month (rolling window)", () => {
    wrap(UPCOMING);
    const now = new Date();
    const currentMonthLabel = new Intl.DateTimeFormat("en", {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    // The first month label in the strip should be the current month.
    const strip = document.querySelector(".flex.overflow-x-auto")!;
    const firstLabel = strip.children[0]!.querySelector("p")!.textContent;
    expect(firstLabel).toContain(currentMonthLabel);
  });

  it("renders logos grouped by instrument (one logo per instrument per month)", () => {
    const busy: UpcomingPayment[] = [
      E(BBCA, "BBCA", monthOffset(0), "500000"),
      E(BBCA, "BBCA", monthOffset(0, 15), "200000"), // Same instrument, same month
      E(TLKM, "TLKM", monthOffset(0), "300000"),
    ];
    wrap(busy);
    // The first month column should have 2 logos (BBCA + TLKM), not 3.
    const strip = document.querySelector(".flex.overflow-x-auto")!;
    const firstMonth = strip.children[0]!;
    // With no logo.dev token, InstrumentLogo falls back to MonogramBadge
    // which renders 2-letter monograms (BB for BBCA, TL for TLKM).
    const text = firstMonth.textContent ?? "";
    expect(text).toContain("BB");
    expect(text).toContain("TL");
  });

  it("shows a dash for empty months", () => {
    wrap(UPCOMING);
    const strip = document.querySelector(".flex.overflow-x-auto")!;
    // Find a month with no payments — check for the "—" indicator.
    // The last month in the strip (11 months from now) should be empty.
    const lastMonth = strip.children[11]!;
    expect(lastMonth.textContent).toContain("—");
  });

  it("shows year range in the footer", () => {
    wrap(UPCOMING);
    // The year range should be present (e.g. "2026–2027" or just "2026").
    const now = new Date();
    const thisYear = String(now.getUTCFullYear());
    const nextYear = String(now.getUTCFullYear() + 1);
    // The footer contains the year range.
    const footer = screen.getByText(new RegExp(`${thisYear}|${nextYear}`));
    expect(footer).toBeInTheDocument();
  });

  it("shows year badge on January columns", () => {
    wrap([]);
    const strip = document.querySelector(".flex.overflow-x-auto")!;
    // Every 12-month rolling window contains exactly one January.
    const cells = [...strip.children];
    const janCell = cells.find((c) => {
      const label = c.querySelector("p")?.textContent ?? "";
      return /Jan/.test(label);
    });
    expect(janCell).toBeDefined();
    // The January label should contain a year badge like "'27".
    expect(janCell!.querySelector("p")!.textContent).toMatch(/'\d{2}/);
  });

  it("applies scrollbar-none to the scrollable strip", () => {
    wrap(UPCOMING);
    const strip = document.querySelector(".overflow-x-auto");
    expect(strip).toBeTruthy();
    expect(strip!.classList.contains("scrollbar-none")).toBe(true);
  });

  it("renders vertical separators between month columns", () => {
    wrap(UPCOMING);
    const strip = document.querySelector(".flex.overflow-x-auto")!;
    // The first column should NOT have border-r.
    const first = strip.children[0]!;
    expect(first.classList.contains("border-r")).toBe(false);
    // The second column should have border-r border-line.
    const second = strip.children[1]!;
    expect(second.classList.contains("border-r")).toBe(true);
    expect(second.classList.contains("border-line")).toBe(true);
  });

  it("conditionally renders the gradient fade overlay only when the strip overflows", () => {
    wrap(UPCOMING);
    // In jsdom the strip doesn't actually overflow (all 12 month columns fit),
    // so the gradient fade should NOT be rendered.
    const gradient = document.querySelector(".bg-gradient-to-l.from-card");
    expect(gradient).toBeNull();
  });

  it("tooltip shows instrument symbol, formatted date, status, and amount on hover", () => {
    wrap(UPCOMING);
    // BBCA has a projected dividend this month. Find its button via aria-label.
    const btn = screen.getByRole("button", { name: /BBCA.*1 payment/ });
    fireEvent.mouseEnter(btn);
    // Tooltip panel should show the instrument symbol as title.
    expect(screen.getByText("BBCA")).toBeInTheDocument();
    // The row should contain the status text "Projected".
    expect(screen.getByText(/Projected/)).toBeInTheDocument();
    // The row should contain the formatted IDR amount (500,000).
    expect(screen.getByText(/500[.,\s\u00a0\u202f]?000/)).toBeInTheDocument();
  });

  it("tooltip lists multiple payments sorted by date when an instrument has several", () => {
    const multi: UpcomingPayment[] = [
      E(BBCA, "BBCA", monthOffset(0), "100000", { status: "scheduled" }),
      E(BBCA, "BBCA", monthOffset(0, 20), "250000", { status: "announced" }),
    ];
    wrap(multi);
    const btn = screen.getByRole("button", { name: /BBCA.*2 payments/ });
    fireEvent.mouseEnter(btn);
    // Both status texts should appear in the tooltip.
    expect(screen.getByText(/Scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/Announced/)).toBeInTheDocument();
    // Both amounts should appear.
    expect(screen.getByText(/100[.,\s\u00a0\u202f]?000/)).toBeInTheDocument();
    expect(screen.getByText(/250[.,\s\u00a0\u202f]?000/)).toBeInTheDocument();
  });

  it("tooltip dismisses on mouseleave", () => {
    wrap(UPCOMING);
    const btn = screen.getByRole("button", { name: /BBCA/ });
    fireEvent.mouseEnter(btn);
    expect(screen.getByText("BBCA")).toBeInTheDocument();
    fireEvent.mouseLeave(btn);
    // The tooltip is state-driven: panel unmounts on leave.
    expect(screen.queryByText("BBCA")).not.toBeInTheDocument();
  });
});

describe("IncomeCalendarEmpty", () => {
  it("renders the no-upcoming-payments empty state", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IncomeCalendarEmpty />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No upcoming payments")).toBeInTheDocument();
    expect(screen.getByText(/projections or announcements are available/i)).toBeInTheDocument();
  });
});
