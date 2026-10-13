import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";
import type { GainSummary } from "@portfolio/api-client";
import { GainFigure, toneOf } from "../src/components/gain-figure";
import { GainExplainer } from "../src/components/gain-explainer";
import { formatNetWorth } from "../src/lib/utils";

const wrap = (ui: React.ReactNode, locale: "en" | "id" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? messages : idMessages}>
    {ui}
  </NextIntlClientProvider>
);

describe("GainFigure (audit G2)", () => {
  it("names the cost-of-holdings basis next to the figure", () => {
    render(wrap(<GainFigure amount="+€100.00" pct="+10.00%" tone="up" basis="cost" />));
    expect(screen.getByText("+€100.00").className).toContain("text-success");
    expect(screen.getByText("vs cost of holdings")).toBeInTheDocument();
  });

  it("names the net-contributed basis", () => {
    render(wrap(<GainFigure amount="-€5.00" pct="-1.00%" tone="down" basis="contributed" />));
    expect(screen.getByText("vs net contributed")).toBeInTheDocument();
    expect(screen.getByText("-€5.00").className).toContain("text-destructive");
  });

  it("inline layout puts percent and basis label on one line", () => {
    render(wrap(<GainFigure pct="+5.00%" tone="up" basis="cost" layout="inline" />));
    const line = screen.getByText("+5.00%").parentElement!;
    expect(line.textContent).toContain("vs cost of holdings");
  });

  it("localises the basis label", () => {
    render(wrap(<GainFigure pct="+5,00%" tone="up" basis="contributed" />, "id"));
    expect(screen.getByText("terhadap kontribusi bersih")).toBeInTheDocument();
  });

  it("toneOf maps sign to tone", () => {
    expect(toneOf(1)).toBe("up");
    expect(toneOf(-1)).toBe("down");
    expect(toneOf(0)).toBe("flat");
    expect(toneOf(null)).toBe("flat");
  });
});

const gain: GainSummary = {
  displayCurrency: "EUR",
  boundary: "outside",
  value: "39044.83",
  costOfOpen: "30000",
  netContributed: "25038.01",
  unrealized: "9044.83",
  realized: "120",
  income: "75.5",
};

describe("GainExplainer", () => {
  it("opens one dialog listing every GainSummary field with its definition", () => {
    render(wrap(<GainExplainer gain={gain} />));
    fireEvent.click(screen.getByRole("button", { name: /How is this gain calculated/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const label of [
      "Value now",
      "Cost of holdings",
      "Net contributed",
      "Unrealized gain",
      "Realized gain",
      "Income",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("€39,044.83")).toBeInTheDocument();
    expect(screen.getByText(/Cash is outside this scope/)).toBeInTheDocument();
  });

  it("explains a mixed-boundary aggregate", () => {
    render(wrap(<GainExplainer gain={{ ...gain, boundary: "mixed" }} />));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/different cash boundaries/)).toBeInTheDocument();
  });
});

describe("formatNetWorth (one formatter for hero + sidebar)", () => {
  it("never rounds differently between surfaces", () => {
    expect(formatNetWorth("39044.83", "EUR", "en")).toBe("€39,044.83");
    expect(formatNetWorth("39045", "EUR", "en")).toBe("€39,045.00");
    // IDR keeps its zero-decimal convention in every surface.
    expect(formatNetWorth("1050000.4", "IDR", "en")).toBe(formatNetWorth(1050000.4, "IDR", "en"));
  });
});
