import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { UpcomingPayment } from "@portfolio/api-client";

// Stub the logo-lookup env so the day-cell logo component deterministically falls
// back to a MonogramBadge — keeps the test focused on structure, not on logo.dev
// token resolution.
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

const UPCOMING: UpcomingPayment[] = [
  E(BBCA, "BBCA", "2026-09-05", "500000"),
  E(TLKM, "TLKM", "2026-09-12", "300000"),
  E(ASII, "ASII", "2026-09-12", "750000", { kind: "coupon", status: "scheduled" }),
  E("i-bumi", "BUMI", "2026-09-20", "100000"),
];

function wrap(upcoming: UpcomingPayment[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <IncomeCalendar upcoming={upcoming} currency="IDR" />
    </NextIntlClientProvider>,
  );
}

// Anchor for translated-message spot-checks in tests below.
const _ = messages.Income;

import { IncomeCalendar } from "../src/components/income/income-calendar";
import { IncomeCalendarEmpty } from "../src/components/income/income-calendar-empty";

describe("IncomeCalendar", () => {
  it("renders a 7-column grid with weekday headers", () => {
    wrap(UPCOMING);
    // Mon..Sun en-US labels from the buildMonthGrid helper.
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Thu")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });

  it("renders exactly one interactive cell per day with events", () => {
    wrap(UPCOMING);
    // Sept 5 (BBCA), Sept 12 (TLKM+ASII), Sept 20 (BUMI) → 3 buttons with a
    // "1 payment"/"2 payments" aria-label. Match the singular form too.
    const cells = screen.getAllByLabelText(/payment/);
    expect(cells).toHaveLength(3);
    // Spillover days + remaining in-month days render as non-interactive gridcells.
    const allCells = screen.getAllByRole("gridcell");
    expect(allCells.length).toBeGreaterThan(28);
  });

  it("shows up to 3 logos in a day cell and a +N more chip for overflow", () => {
    const busy: UpcomingPayment[] = [
      E(BBCA, "BBCA", "2026-09-05", "500000"),
      E(TLKM, "TLKM", "2026-09-05", "300000"),
      E(ASII, "ASII", "2026-09-05", "750000"),
      E("i-bumi", "BUMI", "2026-09-05", "100000"),
      E("i-mdka", "MDKA", "2026-09-05", "200000"),
    ];
    wrap(busy);
    const cell = screen.getByLabelText(/5 payments/);
    // The component falls back to a monogram badge in tests (no logo token) — the
    // inline monograms are the 2-letter initials of each symbol. Only 3 show inline,
    // the other 2 collapse into the "+2 more" chip.
    const inline = within(cell).getAllByText(/^(BB|TL|AS|BU|MD)$/);
    expect(inline).toHaveLength(3);
    expect(within(cell).getByText("+2 more")).toBeInTheDocument();
  });

  it("opens the per-day popover with the day's full event list when clicked", () => {
    const busy: UpcomingPayment[] = [
      E(BBCA, "BBCA", "2026-09-05", "500000"),
      E(TLKM, "TLKM", "2026-09-05", "300000"),
      E(ASII, "ASII", "2026-09-05", "750000"),
      E("i-bumi", "BUMI", "2026-09-05", "100000"),
      E("i-mdka", "MDKA", "2026-09-05", "200000"),
    ];
    wrap(busy);
    fireEvent.click(screen.getByLabelText(/5 payments/));
    // Popover lists every ticker — overflow events are visible here even when
    // they were elided in the cell.
    expect(screen.getByText("BBCA")).toBeInTheDocument();
    expect(screen.getByText("TLKM")).toBeInTheDocument();
    expect(screen.getByText("ASII")).toBeInTheDocument();
    expect(screen.getByText("BUMI")).toBeInTheDocument();
    expect(screen.getByText("MDKA")).toBeInTheDocument();
  });

  it("renders status legend chips for scheduled/projected/paid", () => {
    wrap(UPCOMING);
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Projected")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("navigates to the next month when clicking the Next button", () => {
    wrap(UPCOMING);
    // Sept 2026 label visible initially (earliest event is in September).
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("October 2026")).toBeInTheDocument();
  });

  it("navigates back to the previous month when clicking Prev", () => {
    wrap(UPCOMING);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("August 2026")).toBeInTheDocument();
  });

  it("offers a 'Today' jump button when the calendar is anchored to a forward month", () => {
    // Push the only event into a future month so the calendar opens onto a
    // month that's NOT today → the "Today" pill should be visible.
    const futureOnly: UpcomingPayment[] = [E(BBCA, "BBCA", "2030-03-05", "500000")];
    wrap(futureOnly);
    // Today button is visible — the calendar is sitting on March 2030, not now.
    expect(screen.getByRole("button", { name: "Jump to today" })).toBeInTheDocument();
    // Clicking it switches the header back to the current month.
    fireEvent.click(screen.getByRole("button", { name: "Jump to today" }));
    // The button disappears once we're back on the current month.
    expect(screen.queryByRole("button", { name: "Jump to today" })).not.toBeInTheDocument();
  });
});

describe("IncomeCalendarEmpty", () => {
  it("renders the no-upcoming-payments empty state when upcoming is empty", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IncomeCalendarEmpty />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No upcoming payments")).toBeInTheDocument();
    // The dedicated copy explains why.
    expect(screen.getByText(/projections or announcements are available/i)).toBeInTheDocument();
  });
});
