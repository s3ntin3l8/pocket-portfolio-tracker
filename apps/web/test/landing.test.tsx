import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: signInMock }));

import { Landing } from "../src/components/landing";

function renderLanding() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Landing />
    </NextIntlClientProvider>,
  );
}

describe("Landing (Pocket split-hero sign-in)", () => {
  beforeEach(() => signInMock.mockReset());

  it("renders the sign-in hero, SSO CTA and connected brokerages", () => {
    renderLanding();

    expect(screen.getByRole("heading", { name: messages.Landing.signInTitle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.Landing.sso })).toBeInTheDocument();
    expect(screen.getByText("Trade Republic · IBKR · DKB")).toBeInTheDocument();
  });

  it("starts Authentik sign-in to /holdings from the SSO button", () => {
    renderLanding();

    fireEvent.click(screen.getByRole("button", { name: messages.Landing.sso }));

    expect(signInMock).toHaveBeenCalledWith("authentik", {
      callbackUrl: "/holdings",
    });
  });

  it("routes the email form through Authentik too (OIDC is the only auth)", () => {
    renderLanding();

    fireEvent.click(screen.getByRole("button", { name: messages.Landing.signIn }));

    expect(signInMock).toHaveBeenCalledWith("authentik", {
      callbackUrl: "/holdings",
    });
  });

  it("submits what was typed when local auth is on", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing localAuthAvailable />
      </NextIntlClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(messages.Landing.emailLabel), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(messages.Landing.passwordLabel), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.Landing.signIn }));

    // handleSubmit reads the fields through FormData, which keys off `name` — not `id`.
    // Without it both values arrive as null and every sign-in fails as CredentialsSignin
    // no matter what the user typed.
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "owner@example.com",
      password: "correct horse battery", // pragma: allowlist secret
      callbackUrl: "/holdings",
    });
  });

  // Regression tests for #487: the demo "portfolio glance" figure was hardcoded to
  // Indonesian Rupiah/punctuation regardless of locale or the returning user's currency.
  it("defaults the demo figure to an Indonesian Rupiah example, formatted for the locale", () => {
    renderLanding();
    expect(screen.getByText("IDR 40,650,000")).toBeInTheDocument();
    expect(screen.getByText("▲ 18.2%")).toBeInTheDocument();
  });

  it("formats the demo figure in the returning user's currency", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing initialCurrency="EUR" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("€24,180")).toBeInTheDocument();
  });

  it("falls back to the Rupiah example for an unrecognized currency", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing initialCurrency="XYZ" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("IDR 40,650,000")).toBeInTheDocument();
  });

  // DEV_AUTH_TOKEN (PR #627) bypasses both the Authentik session cookie and the local-auth
  // form — with it active, the SSO button/email form are dead ends, so devBypass swaps them
  // for a plain entry link instead.
  it("renders a dev-entry link to /holdings instead of sign-in when devBypass is set", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Landing devBypass />
      </NextIntlClientProvider>,
    );

    const link = screen.getByRole("link", { name: messages.Landing.devEnter });
    expect(link).toHaveAttribute("href", "/holdings");
    expect(screen.queryByRole("button", { name: messages.Landing.sso })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.Landing.signIn })).not.toBeInTheDocument();
  });
});
