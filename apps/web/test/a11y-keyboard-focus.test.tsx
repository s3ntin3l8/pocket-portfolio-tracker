import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import {
  AddTransactionForm,
  type AddTransactionClient,
} from "../src/components/add-transaction-form";
import { HolderTypeChips } from "../src/components/holder-type-chips";
import { RouteTransition } from "../src/components/route-transition";
import { TradeMethodToggle } from "../src/components/trade-method-toggle";
import type { Instrument } from "@portfolio/api-client";

const { routerPush, pathnameRef } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  pathnameRef: { current: "/trades" },
}));

// The real module calls next-intl/navigation → next/navigation, which can't resolve in
// jsdom (the vitest alias points at a stub). Keep the stub's exports, but make the
// pathname and the router observable.
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePathname: () => pathnameRef.current,
    useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  };
});

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    getSourceDocumentUrl: vi.fn(async () => ({
      url: "https://storage.example/settlement.pdf?sig=test",
      filename: "settlement.pdf",
      mimeType: "application/pdf",
    })),
  }),
}));

const m = messages.Manage.tx;

const INSTRUMENT: Instrument = {
  id: "i1",
  isin: null,
  wkn: null,
  symbol: "BBCA",
  market: "IDX",
  assetClass: "equity",
  unit: "shares",
  currency: "IDR",
  name: "Bank Central Asia",
};

function makeClient(): AddTransactionClient {
  return {
    searchInstruments: vi.fn(async () => []),
    lookupInstruments: vi.fn(async () => []),
    createInstrument: vi.fn(async () => INSTRUMENT),
    createTransaction: vi.fn(async () => ({}) as never),
    updateTransaction: vi.fn(async () => ({}) as never),
    getGoldSources: vi.fn(async () => [{ market: "ANTAM", label: "Antam buyback" }]),
    listLoans: vi.fn(async () => []),
  };
}

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AddTransactionForm client={makeClient()} portfolioId="p1" onSuccess={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

/** The `aria-controls` target must exist — a disclosure that points at nothing is broken. */
function controlledPanel(toggle: HTMLElement) {
  const id = toggle.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const panel = id ? document.getElementById(id) : null;
  expect(panel).not.toBeNull();
  return panel;
}

/**
 * The radio pattern: one tab stop for the whole group, and entering it lands on the
 * checked option (Radix's roving focus group implements exactly that).
 */
function expectRadioPattern(group: HTMLElement, options: HTMLElement[], checkedIndex: number) {
  expect(options[checkedIndex]).toHaveAttribute("aria-checked", "true");
  options.forEach((option, i) => {
    if (i !== checkedIndex) expect(option).toHaveAttribute("aria-checked", "false");
  });
  // One tab stop: the group itself, not each option.
  expect(group).toHaveAttribute("tabindex", "0");
  options.forEach((option) => expect(option).toHaveAttribute("tabindex", "-1"));

  act(() => {
    group.focus();
  });
  expect(document.activeElement).toBe(options[checkedIndex]);
  expect(options[checkedIndex]).toHaveAttribute("tabindex", "0");
}

describe("cost-basis method toggle", () => {
  it("exposes the selected method as a radio group", () => {
    render(
      <TradeMethodToggle
        current="average"
        labelAverage="Average cost"
        labelFifo="FIFO"
        aria-label="Cost method"
      />,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-label", "Cost method");

    const [average, fifo] = screen.getAllByRole("radio");
    expectRadioPattern(group, [average, fifo], 0);
  });

  it("moves within the group with the arrow keys", async () => {
    render(<TradeMethodToggle current="average" labelAverage="Average cost" labelFifo="FIFO" />);

    const group = screen.getByRole("radiogroup");
    const [average, fifo] = screen.getAllByRole("radio");
    act(() => {
      group.focus();
    });
    act(() => {
      fireEvent.keyDown(average, { key: "ArrowRight" });
    });
    await waitFor(() => expect(document.activeElement).toBe(fifo));
  });

  it("navigates to the other method when the other option is picked", () => {
    routerPush.mockClear();
    render(<TradeMethodToggle current="average" labelAverage="Average cost" labelFifo="FIFO" />);

    fireEvent.click(screen.getByRole("radio", { name: "FIFO" }));
    expect(routerPush).toHaveBeenCalledWith("/trades?method=fifo");
  });
});

describe("add-transaction disclosures", () => {
  it("reports the custom-instrument disclosure state", () => {
    renderForm();

    const toggle = screen.getByRole("button", { name: m.customInstrumentToggle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(controlledPanel(toggle)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(controlledPanel(toggle)).toBeInTheDocument();
  });

  it("reports the fees/tax disclosure state and rotates its chevron only when open", () => {
    renderForm();

    const toggle =
      screen.queryByRole("button", { name: m.extrasFeesTax }) ??
      screen.getByRole("button", { name: m.extrasFees });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(controlledPanel(toggle)).toBeInTheDocument();
    // Closed: the chevron points sideways, i.e. it is not rotated.
    expect(toggle.querySelector("svg")?.getAttribute("class")).not.toContain("rotate-90");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(controlledPanel(toggle)).toBeInTheDocument();
    expect(toggle.querySelector("svg")?.getAttribute("class")).toContain("rotate-90");
  });

  it("collapses the fees/tax disclosure again — the button that says it is expanded must be able to close it", () => {
    renderForm();

    const toggle =
      screen.queryByRole("button", { name: m.extrasFeesTax }) ??
      screen.getByRole("button", { name: m.extrasFees });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // The disclosure stays mounted while open, so it has to be a real toggle: a button
    // that advertises `aria-expanded="true"` and can only expand lies about being operable.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg")?.getAttribute("class")).not.toContain("rotate-90");
  });
});

describe("holder-type chips", () => {
  it("exposes the radio pattern", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HolderTypeChips value="child" onChange={onChange} labelledBy="holder-type-label" />
      </NextIntlClientProvider>,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-labelledby", "holder-type-label");

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    expectRadioPattern(group, options, 1);

    fireEvent.click(options[2]);
    expect(onChange).toHaveBeenCalledWith("other");
  });
});

describe("route transition", () => {
  it("moves focus to the new page's heading after a route change, but not on the first paint", () => {
    const scrollContainerRef = { current: null } as React.RefObject<HTMLDivElement | null>;

    pathnameRef.current = "/holdings";
    const { rerender } = render(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <h1>Holdings</h1>
      </RouteTransition>,
    );

    // First paint: the page is already the right one — focus must not be stolen.
    expect(document.activeElement).toBe(document.body);

    pathnameRef.current = "/trades";
    rerender(
      <RouteTransition scrollContainerRef={scrollContainerRef}>
        <h1>Trades</h1>
      </RouteTransition>,
    );

    const heading = screen.getByRole("heading", { name: "Trades" });
    expect(document.activeElement).toBe(heading);
    // A heading is not focusable by default — the transition adds tabindex="-1".
    expect(heading).toHaveAttribute("tabindex", "-1");
  });
});
