import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { GoldHoldingRow, GoldPlan } from "@portfolio/api-client";
import messages from "../messages/en.json";
import { GoldPlanCard } from "../src/components/reports/gold/gold-plan-card";
import { GoldHoldingsTable } from "../src/components/reports/gold/gold-holdings-table";

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

const PLAN: GoldPlan = {
  loanId: "l1",
  instrumentId: "i1",
  portfolioId: "p1",
  provider: "GALERI24",
  contractNo: "C-1",
  currency: "IDR",
  grams: "5",
  purchasePrice: "6000000",
  downPayment: "1000000",
  principal: "5000000",
  marginTotal: "500000",
  tenorMonths: 4,
  monthlyInstallment: "1375000",
  startDate: "2026-01-13",
  paidCount: 1,
  remainingCount: 3,
  paidPrincipal: "1250000",
  paidMargin: "125000",
  outstandingPrincipal: "3750000",
  nextDue: { n: 2, dueDate: "2026-02-13", amount: "1375000", overdue: false },
  completed: false,
  value: "6100000",
  valuedAtCost: false,
  fxMissing: false,
  schedule: [1, 2, 3, 4].map((n) => ({
    n,
    dueDate: `2026-0${n + 1}-13`,
    pokok: "1250000",
    sewaModal: "125000",
    angsuran: "1375000",
    paid: n === 1,
    overdue: false,
  })),
};

describe("GoldPlanCard", () => {
  it("shows progress, what is owed and the next installment", () => {
    wrap(<GoldPlanCard plan={PLAN} title="LM 5 Gram" displayCurrency="IDR" locale="en" />);
    expect(screen.getByRole("heading", { name: "LM 5 Gram" })).toBeInTheDocument();
    expect(screen.getByText("1 of 4 installments paid")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText(/Next installment:/)).toBeInTheDocument();
    expect(screen.getByText("5 g")).toBeInTheDocument();
    // Still owed (3,750,000) is shown in the contract currency.
    expect(screen.getByText(/3,750,000/)).toBeInTheDocument();
  });

  it("lists the schedule with a status per installment", () => {
    wrap(<GoldPlanCard plan={PLAN} title={null} displayCurrency="IDR" locale="en" />);
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Paid")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Upcoming")).toBeInTheDocument();
    // No title → falls back to the contract number.
    expect(screen.getByRole("heading", { name: "C-1" })).toBeInTheDocument();
  });

  it("flags an overdue installment", () => {
    const overdue: GoldPlan = {
      ...PLAN,
      nextDue: { n: 2, dueDate: "2026-02-13", amount: "1375000", overdue: true },
      schedule: PLAN.schedule.map((r) => (r.n === 2 ? { ...r, overdue: true } : r)),
    };
    wrap(<GoldPlanCard plan={overdue} title="LM" displayCurrency="IDR" locale="en" />);
    // The plan status badge and the overdue schedule row.
    expect(screen.getAllByText("Overdue")).toHaveLength(2);
    expect(screen.getByText(/Overdue installment:/)).toBeInTheDocument();
  });

  it("marks a finished plan completed with no next installment", () => {
    const done: GoldPlan = {
      ...PLAN,
      paidCount: 4,
      remainingCount: 0,
      outstandingPrincipal: "0",
      nextDue: null,
      completed: true,
      schedule: PLAN.schedule.map((r) => ({ ...r, paid: true })),
    };
    wrap(<GoldPlanCard plan={done} title="LM" displayCurrency="IDR" locale="en" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText(/Next installment:/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  });

  it("shows no buyback value without an FX rate, and notes at-cost valuation", () => {
    wrap(
      <GoldPlanCard
        plan={{ ...PLAN, fxMissing: true, value: null }}
        title="LM"
        displayCurrency="EUR"
        locale="en"
      />,
    );
    expect(screen.getByText("Buyback value").nextElementSibling).toHaveTextContent("—");
    wrap(
      <GoldPlanCard
        plan={{ ...PLAN, valuedAtCost: true }}
        title="LM2"
        displayCurrency="IDR"
        locale="en"
      />,
    );
    expect(screen.getByText("No buyback price available — valued at cost.")).toBeInTheDocument();
  });
});

const ROW: GoldHoldingRow = {
  portfolioId: "p1",
  instrumentId: "i1",
  symbol: "G24:1",
  name: "LM 5 Gram",
  market: "GALERI24",
  grams: "5",
  pricePerGram: "1220000",
  currency: "IDR",
  value: "6100000",
  cost: "6000000",
  unrealized: "100000",
  valuedAtCost: false,
  fxMissing: false,
};

describe("GoldHoldingsTable", () => {
  it("renders weight, buyback per gram, value and a signed gain", () => {
    wrap(<GoldHoldingsTable holdings={[ROW]} displayCurrency="IDR" locale="en" />);
    expect(screen.getByText("LM 5 Gram")).toBeInTheDocument();
    expect(screen.getByText("GALERI24")).toBeInTheDocument();
    expect(screen.getByText("5 g")).toBeInTheDocument();
    expect(screen.getByText(/\+.*100,000/)).toBeInTheDocument();
  });

  it("shows — instead of a made-up zero gain for at-cost and no-FX rows", () => {
    const atCost: GoldHoldingRow = {
      ...ROW,
      instrumentId: "i2",
      name: "UBS 2 Gram",
      valuedAtCost: true,
      unrealized: "0",
    };
    const noFx: GoldHoldingRow = {
      ...ROW,
      instrumentId: "i3",
      name: "Foreign bar",
      fxMissing: true,
      value: null,
      unrealized: null,
    };
    wrap(<GoldHoldingsTable holdings={[atCost, noFx]} displayCurrency="IDR" locale="en" />);
    expect(screen.getByText("valued at cost")).toBeInTheDocument();
    expect(screen.getByText("no FX rate")).toBeInTheDocument();
    const [atCostRow, noFxRow] = screen.getAllByRole("row").slice(1);
    // Gain cell (last) is "—" for both; the FX-less row also has no value.
    expect(within(atCostRow).getAllByRole("cell").at(-1)).toHaveTextContent("—");
    expect(within(noFxRow).getAllByRole("cell").at(-1)).toHaveTextContent("—");
    expect(within(noFxRow).getAllByRole("cell").at(-2)).toHaveTextContent("—");
    expect(screen.queryByText(/\+0/)).not.toBeInTheDocument();
  });
});
