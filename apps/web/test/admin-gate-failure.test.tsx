import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminGateFailure } from "../src/components/admin-gate-failure";

function renderGate(gate: React.ComponentProps<typeof AdminGateFailure>["gate"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminGateFailure gate={gate} />
    </NextIntlClientProvider>,
  );
}

describe("AdminGateFailure", () => {
  it("rate_limited shows the countdown retry, never a not-found message", () => {
    renderGate({ status: "rate_limited", retryAfter: 7 });
    expect(screen.getByRole("button", { name: /7/ })).toBeTruthy();
    expect(screen.queryByText(/not found/i)).toBeNull();
  });

  it("unavailable offers Retry", () => {
    renderGate({ status: "unavailable" });
    expect(screen.getByRole("button", { name: messages.DataState.retry })).toBeTruthy();
  });

  it("unauthorized offers sign in", () => {
    renderGate({ status: "unauthorized" });
    expect(screen.getByRole("link", { name: messages.DataState.signIn })).toBeTruthy();
  });
});
