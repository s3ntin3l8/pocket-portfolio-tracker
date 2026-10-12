import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";
import { RegimeIndicator } from "../src/components/tax/regime-indicator";
import { ReportHeader } from "../src/components/report-header";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function Indicator({ regime }: { regime: "DE" | "ID" }) {
  const t = useTranslations("Tax");
  return <RegimeIndicator regime={regime} t={(k, v) => t(k as never, v as never)} />;
}

function renderIndicator(regime: "DE" | "ID", msgs: typeof messages = messages, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={msgs}>
      <ReportHeader title="Tax" subtitle={<Indicator regime={regime} />} />
    </NextIntlClientProvider>,
  );
}

describe("Tax page regime indicator", () => {
  it("shows the active regime and links to Settings > Investing", () => {
    renderIndicator("DE");
    expect(screen.getByTestId("tax-regime-indicator")).toHaveTextContent(
      "Regime: Germany · Change",
    );
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute(
      "href",
      "/settings/investing",
    );
  });

  it("shows Indonesia for the ID regime", () => {
    renderIndicator("ID");
    expect(screen.getByTestId("tax-regime-indicator")).toHaveTextContent("Regime: Indonesia");
  });

  it("renders no mutating toggle (no buttons, no pressed state)", () => {
    renderIndicator("DE");
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("[aria-pressed]")).toBeNull();
    expect(screen.queryByText(/applies everywhere/i)).toBeNull();
  });

  it("is translated", () => {
    renderIndicator("DE", idMessages as unknown as typeof messages, "id");
    expect(screen.getByTestId("tax-regime-indicator")).toHaveTextContent("Rezim: Jerman · Ubah");
  });
});
