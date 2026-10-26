import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { IntegrityAbstention, IntegrityFinding, IntegrityReport } from "@portfolio/api-client";
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
  abstentions: [],
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
    await screen.findByText(/No check found a mismatch/);
    expect(screen.getByRole("button", { name: m.integrityRerun })).toBeEnabled();
  });

  it("says every check holds, naming how many ran, when there are no findings", async () => {
    renderPanel(vi.fn(async () => report()));
    run();
    expect(
      await screen.findByText("No check found a mismatch (11 rules, 2 portfolios)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("uses the singular for one portfolio", async () => {
    renderPanel(vi.fn(async () => report({ portfolioCount: 1 })));
    run();
    expect(
      await screen.findByText("No check found a mismatch (11 rules, 1 portfolio)."),
    ).toBeInTheDocument();
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
    expect(screen.queryByText(/No check found a mismatch/)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/No check found a mismatch/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: m.integrityRerun }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(/No check found a mismatch/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  describe("what was skipped", () => {
    const skipped = (over: Partial<IntegrityAbstention> = {}): IntegrityAbstention => ({
      rule: "HISTORY_SUMS_PORTFOLIOS",
      scope: "networth",
      reason: "foreign_currency",
      ...over,
    });

    it("does not present a run that skipped data as fully checked", async () => {
      const { container } = renderPanel(vi.fn(async () => report({ abstentions: [skipped()] })));
      run();
      expect(await screen.findByText(/No check found a mismatch/)).toBeInTheDocument();
      expect(
        screen.getByText("1 comparison was skipped and is not known to be consistent:"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(m.integrityRule_HISTORY_SUMS_PORTFOLIOS)),
      ).toBeInTheDocument();
      expect(screen.getByText(new RegExp(m.integrityAbstain_foreign_currency))).toBeInTheDocument();
      // No green all-clear shield: something was not compared.
      expect(container.querySelector(".text-success")).toBeNull();
    });

    it("shows the green shield only when nothing was skipped", async () => {
      const { container } = renderPanel(vi.fn(async () => report()));
      run();
      await screen.findByText(/No check found a mismatch/);
      expect(container.querySelector(".text-success")).not.toBeNull();
      expect(screen.queryByText(/not known to be consistent/)).not.toBeInTheDocument();
    });

    it("does not claim a full pass when the server does not report skips at all", async () => {
      const { container } = renderPanel(vi.fn(async () => report({ abstentions: undefined })));
      run();
      await screen.findByText(/No check found a mismatch/);
      expect(container.querySelector(".text-success")).toBeNull();
      expect(screen.queryByText(/not known to be consistent/)).not.toBeInTheDocument();
    });

    it("lists skipped comparisons next to findings, grouped by rule and reason", async () => {
      renderPanel(
        vi.fn(async () =>
          report({
            findings: [finding()],
            abstentions: [
              skipped({
                rule: "CONTRIB_PARITY",
                scope: "portfolio:a",
                reason: "currency_mismatch",
              }),
              skipped({
                rule: "CONTRIB_PARITY",
                scope: "portfolio:b",
                reason: "currency_mismatch",
              }),
            ],
          }),
        ),
      );
      run();
      expect(await screen.findByText("1 check failed")).toBeInTheDocument();
      expect(
        screen.getByText("2 comparisons were skipped and are not known to be consistent:"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          new RegExp(
            `${m.integrityRule_CONTRIB_PARITY}.*${m.integrityAbstain_currency_mismatch} \\(2\\)`,
          ),
        ),
      ).toBeInTheDocument();
    });

    it("shows an unknown rule or reason from a newer server as it is", async () => {
      renderPanel(
        vi.fn(async () =>
          report({ abstentions: [skipped({ rule: "NEW_RULE", reason: "new_reason" })] }),
        ),
      );
      run();
      expect(await screen.findByText(/NEW_RULE — new_reason/)).toBeInTheDocument();
    });
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
