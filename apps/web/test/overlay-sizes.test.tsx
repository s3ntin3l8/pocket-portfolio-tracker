import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    getPortfolioTargets: async () => [],
    putPortfolioTargets: async () => [],
    getNetworthTargets: async () => [],
  }),
}));

import { RebalanceDialog } from "../src/components/savings/rebalance-dialog";
import { TargetDialog } from "../src/components/allocation/target-dialog";
import { ApiTokensManager } from "../src/components/api-tokens-manager";

/**
 * Overlay-chrome invariant (audit E10): task-tier dialogs size through `DialogContent`'s
 * `size` scale. An unprefixed `max-w-*` / `rounded-*` override wins over the mobile
 * `max-w-none`/`rounded-none` full-screen state and pins a narrow panel to the left on
 * phones, so none of these may carry one.
 */
function expectScaleSized(dialog: HTMLElement) {
  const tokens = dialog.className.split(/\s+/);
  expect(tokens).toContain("md:max-w-[480px]"); // size="sm"
  expect(tokens).toContain("max-w-none"); // mobile full-screen state intact
  expect(tokens).not.toContain("max-w-sm");
  expect(tokens).not.toContain("max-w-[420px]");
  expect(tokens).not.toContain("rounded-[22px]");
}

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("task-tier dialogs use DialogContent's size scale", () => {
  it("RebalanceDialog", async () => {
    render(
      wrap(
        <RebalanceDialog
          portfolioId="pf-1"
          plans={[]}
          activeMonthlyTotalDisplay="0"
          currency="EUR"
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /set target split/i }));
    await waitFor(() => expectScaleSized(screen.getByRole("dialog")));
  });

  it("TargetDialog", async () => {
    render(
      wrap(
        <TargetDialog
          portfolioId="pf-1"
          dimension="asset_class"
          dimensionLabel="Asset class"
          slices={[]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: messages.TargetDialog.trigger }));
    await waitFor(() => expectScaleSized(screen.getByRole("dialog")));
  });

  it("ApiTokensManager create modal", async () => {
    render(
      wrap(
        <ApiTokensManager
          client={{ listApiTokens: vi.fn(), createApiToken: vi.fn(), deleteApiToken: vi.fn() }}
          initialTokens={[]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: messages.Settings.tokensCreate }));
    await waitFor(() => expectScaleSized(screen.getByRole("dialog")));
    expect(
      within(screen.getByRole("dialog")).getAllByText(messages.Settings.tokensCreateTitle),
    ).toHaveLength(2);
  });
});
