import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FxMissingBanner } from "../src/components/fx-missing-banner";
import { collectFxMissing } from "../src/lib/fx-missing";
import messages from "../messages/en.json";

function renderBanner(currencies: string[] | null | undefined) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FxMissingBanner currencies={currencies} />
    </NextIntlClientProvider>,
  );
}

describe("FxMissingBanner (audit B2)", () => {
  it("renders nothing when every rate resolved", () => {
    const { container } = renderBanner([]);
    expect(container).toBeEmptyDOMElement();
    expect(renderBanner(undefined).container).toBeEmptyDOMElement();
  });

  it("names the currencies left out of the totals", () => {
    renderBanner(["SGD", "USD"]);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(messages.FxMissing.title);
    expect(banner).toHaveTextContent("SGD, USD");
    expect(banner).toHaveTextContent(/left out of the totals/);
  });
});

describe("collectFxMissing", () => {
  it("unions, dedupes and sorts across payloads, ignoring empties", () => {
    expect(
      collectFxMissing(
        { fxMissingCurrencies: ["USD"] },
        null,
        undefined,
        { fxMissingCurrencies: ["SGD", "USD"] },
        ["CHF"],
        {},
      ),
    ).toEqual(["CHF", "SGD", "USD"]);
  });
});
