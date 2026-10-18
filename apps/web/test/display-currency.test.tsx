import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const refresh = vi.fn();
const updateMe = vi.fn(async () => ({}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ updateMe }),
}));

import { DisplayCurrency } from "../src/components/display-currency";

function renderCurrency(current = "IDR") {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DisplayCurrency current={current} />
    </NextIntlClientProvider>,
  );
}

describe("DisplayCurrency", () => {
  beforeEach(() => {
    refresh.mockClear();
    updateMe.mockClear();
  });

  it("marks the current currency as pressed", () => {
    renderCurrency("EUR");
    expect(screen.getByRole("radio", { name: "EUR" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "USD" })).toHaveAttribute("aria-checked", "false");
  });

  it("persists a new currency immediately and refreshes", async () => {
    renderCurrency("IDR");
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ displayCurrency: "USD" }));
    // The selection only flips after updateMe resolves and React re-renders; under load
    // that lands after the call itself is visible, so wait for it rather than assume it.
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "USD" })).toHaveAttribute("aria-checked", "true"),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("does nothing when the current currency is clicked again", () => {
    renderCurrency("IDR");
    fireEvent.click(screen.getByRole("radio", { name: "IDR" }));
    expect(updateMe).not.toHaveBeenCalled();
  });
});
