import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  RecordCorporateActionForm,
  type RecordCorpActionClient,
} from "../src/components/record-corporate-action-form";
import type { Instrument } from "@portfolio/api-client";
import messages from "../messages/en.json";

const m = messages.CorpAction;

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

function inst(id: string, symbol: string): Instrument {
  return {
    id,
    isin: null,
    wkn: null,
    symbol,
    market: "XETRA",
    assetClass: "etf",
    unit: "shares",
    currency: "EUR",
    name: symbol,
  };
}
const OLD = inst("i-old", "OLDF");
const NEW = inst("i-new", "NEWF");

function makeClient(over: Partial<RecordCorpActionClient> = {}): RecordCorpActionClient {
  return {
    searchInstruments: vi.fn(async (q?: string) => {
      if (q?.includes("new")) return [NEW];
      if (q?.includes("old")) return [OLD];
      return [INSTRUMENT];
    }),
    lookupInstruments: vi.fn(async () => []),
    createCorporateAction: vi.fn(async () => ({})),
    createMerger: vi.fn(async () => ({})),
    ...over,
  };
}

function renderForm(
  client: RecordCorpActionClient,
  onSuccess = vi.fn(),
  isAdmin?: boolean,
  portfolioId?: string,
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RecordCorporateActionForm
        client={client}
        portfolioId={portfolioId}
        onSuccess={onSuccess}
        isAdmin={isAdmin}
      />
    </NextIntlClientProvider>,
  );
  return onSuccess;
}

describe("RecordCorporateActionForm", () => {
  it("records a split against a selected instrument", async () => {
    const client = makeClient();
    const onSuccess = renderForm(client, vi.fn(), true);

    fireEvent.change(screen.getByLabelText(m.search), {
      target: { value: "bbca" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /BBCA/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /BBCA/ }));

    fireEvent.change(screen.getByLabelText(m.ratio), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(m.exDate, { selector: "input" }), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: m.submit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(client.createCorporateAction).toHaveBeenCalledWith(
      expect.objectContaining({ instrumentId: "i1", type: "split", ratio: "2" }),
    );
  });

  it("requires an instrument for split/bonus/rights", async () => {
    const client = makeClient();
    renderForm(client, vi.fn(), true);

    fireEvent.change(screen.getByLabelText(m.ratio), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(m.exDate, { selector: "input" }), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: m.submit }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(m.needInstrument));
    expect(client.createCorporateAction).not.toHaveBeenCalled();
  });

  it("records a tax-neutral merger between two selected instruments", async () => {
    const client = makeClient();
    const onSuccess = renderForm(client, vi.fn(), true, "p1");

    // Switch to merger type
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "merger" } });

    // Pick from instrument
    fireEvent.change(screen.getByLabelText(m.mergerFrom), { target: { value: "old" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /OLDF/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /OLDF/ }));

    // Pick to instrument
    fireEvent.change(screen.getByLabelText(m.mergerTo), { target: { value: "new" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /NEWF/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /NEWF/ }));

    fireEvent.change(screen.getByLabelText(m.mergerOutQty), { target: { value: "48.1464" } });
    fireEvent.change(screen.getByLabelText(m.mergerInQty), { target: { value: "360.218" } });
    fireEvent.change(screen.getByLabelText(m.mergerDate, { selector: "input" }), {
      target: { value: "2024-01-23" },
    });
    fireEvent.click(screen.getByRole("button", { name: m.mergerSubmit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(client.createMerger).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        fromInstrumentId: "i-old",
        toInstrumentId: "i-new",
        outQty: "48.1464",
        inQty: "360.218",
        taxable: false,
        marketValue: undefined,
      }),
    );
  });

  it("requires both instruments for merger", async () => {
    const client = makeClient();
    renderForm(client, vi.fn(), true, "p1");

    // Switch to merger type
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "merger" } });

    fireEvent.change(screen.getByLabelText(m.mergerOutQty), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(m.mergerInQty), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(m.mergerDate, { selector: "input" }), {
      target: { value: "2024-01-23" },
    });
    fireEvent.click(screen.getByRole("button", { name: m.mergerSubmit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(m.mergerNeedInstruments),
    );
    expect(client.createMerger).not.toHaveBeenCalled();
  });

  it("wraps the submit button in a sticky footer when stickyFooter is set", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RecordCorporateActionForm client={makeClient()} onSuccess={vi.fn()} stickyFooter isAdmin />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: m.submit }).closest(".sticky")).not.toBeNull();
  });
});
