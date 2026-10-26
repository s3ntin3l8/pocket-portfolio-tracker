import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { IntegrityFinding, IntegrityReport } from "@portfolio/api-client";
import {
  IntegrityCheckPanel,
  type IntegrityCheckClient,
} from "../src/components/integrity-check-panel";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";

const m = messages.Settings;

const finding = (over: Partial<IntegrityFinding> = {}): IntegrityFinding => ({
  rule: "NW_SUM_PORTFOLIOS",
  scope: "networth",
  expected: "1260",
  actual: "1261",
  diff: "1",
  tolerance: "1.26e-6",
  message: "api message",
  ...over,
});

const report = (over: Partial<IntegrityReport> = {}): IntegrityReport => ({
  checkedAt: "2026-06-30T12:00:00.000Z",
  portfolioCount: 2,
  rulesRun: Array.from({ length: 11 }, (_, i) => `R${i}`),
  findings: [],
  ...over,
});

function renderPanel(
  getIntegrityReport: IntegrityCheckClient["getIntegrityReport"],
  locale: "en" | "id" = "en",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? messages : idMessages}>
      <IntegrityCheckPanel client={{ getIntegrityReport }} />
    </NextIntlClientProvider>,
  );
}

const run = () => fireEvent.click(screen.getByRole("button", { name: m.integrityRun }));

describe("IntegrityCheckPanel", () => {
  it("shows only the explanation and a run button until it is run", () => {
    const get = vi.fn();
    renderPanel(get);
    expect(screen.getByText(m.integrityHint)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.integrityRun })).toBeEnabled();
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button while running and does not start a second run", async () => {
    let resolve!: (r: IntegrityReport) => void;
    const get = vi.fn(() => new Promise<IntegrityReport>((r) => (resolve = r)));
    renderPanel(get);
    run();
    const busy = await screen.findByRole("button", { name: new RegExp(m.integrityRunning) });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(get).toHaveBeenCalledTimes(1);
    resolve(report());
    await screen.findByText(/checks hold/);
    expect(screen.getByRole("button", { name: m.integrityRerun })).toBeEnabled();
  });

  it("says every check holds, naming how many ran, when there are no findings", async () => {
    renderPanel(vi.fn(async () => report()));
    run();
    expect(await screen.findByText("All 11 checks hold across 2 portfolios.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("uses the singular for one portfolio", async () => {
    renderPanel(vi.fn(async () => report({ portfolioCount: 1 })));
    run();
    expect(await screen.findByText("All 11 checks hold across 1 portfolio.")).toBeInTheDocument();
  });

  it("lists each finding with its meaning, scope and the API's own figures", async () => {
    renderPanel(
      vi.fn(async () =>
        report({
          findings: [
            finding(),
            finding({
              rule: "HOLDINGS_SUM",
              scope: "portfolio:0123456789abcdef",
              expected: "100.5",
              actual: "90.25",
              diff: "10.25",
            }),
          ],
        }),
      ),
    );
    run();
    expect(await screen.findByText("2 checks failed")).toBeInTheDocument();
    expect(screen.getByText(m.integrityRule_NW_SUM_PORTFOLIOS)).toBeInTheDocument();
    expect(screen.getByText(m.integrityRule_HOLDINGS_SUM)).toBeInTheDocument();
    expect(screen.getByText(/All portfolios/)).toBeInTheDocument();
    expect(screen.getByText(/Portfolio 01234567/)).toBeInTheDocument();
    // The figures are the API's strings, untouched.
    for (const v of ["1260", "1261", "100.5", "90.25", "10.25"]) {
      expect(screen.getByText(v)).toBeInTheDocument();
    }
    expect(screen.queryByText(/checks hold/)).not.toBeInTheDocument();
  });

  it("uses the singular for one failed check", async () => {
    renderPanel(vi.fn(async () => report({ findings: [finding()] })));
    run();
    expect(await screen.findByText("1 check failed")).toBeInTheDocument();
  });

  it("falls back to the API's message for a rule the web does not know yet", async () => {
    renderPanel(
      vi.fn(async () =>
        report({ findings: [finding({ rule: "BRAND_NEW_RULE", message: "A new rule broke" })] }),
      ),
    );
    run();
    expect(await screen.findByText("A new rule broke")).toBeInTheDocument();
  });

  it("a failed run is an error, never the all-clear, and can be retried", async () => {
    const get = vi
      .fn<IntegrityCheckClient["getIntegrityReport"]>()
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValueOnce(report());
    renderPanel(get);
    run();
    expect(await screen.findByRole("alert")).toHaveTextContent(m.integrityError);
    expect(screen.queryByText(/checks hold/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: m.integrityRerun }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(/checks hold/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("renders in Indonesian", async () => {
    renderPanel(
      vi.fn(async () => report({ findings: [finding()] })),
      "id",
    );
    fireEvent.click(screen.getByRole("button", { name: idMessages.Settings.integrityRun }));
    expect(await screen.findByText("1 pemeriksaan gagal")).toBeInTheDocument();
    expect(
      screen.getByText(idMessages.Settings.integrityRule_NW_SUM_PORTFOLIOS),
    ).toBeInTheDocument();
  });
});
