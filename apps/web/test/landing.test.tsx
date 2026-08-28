import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: signInMock }));

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Landing } from "../src/components/landing";

function renderLanding(props: React.ComponentProps<typeof Landing> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Landing {...props} />
    </NextIntlClientProvider>,
  );
}

describe("Landing (Pocket split-hero sign-in)", () => {
  beforeEach(() => {
    signInMock.mockReset();
    push.mockReset();
  });

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

  it("routes the email form through Authentik when local auth is off (OIDC is the only auth)", () => {
    renderLanding();

    fireEvent.click(screen.getByRole("button", { name: messages.Landing.signIn }));

    expect(signInMock).toHaveBeenCalledWith("authentik", {
      callbackUrl: "/holdings",
    });
  });

  it("hides the SSO button and CTA divider when Authentik isn't configured", () => {
    renderLanding({ authentikAvailable: false });

    expect(screen.queryByRole("button", { name: messages.Landing.sso })).not.toBeInTheDocument();
    expect(screen.queryByText(messages.Landing.orEmail)).not.toBeInTheDocument();
  });

  it("submits what was typed when local auth is on, then navigates on success", async () => {
    signInMock.mockResolvedValue({ error: undefined, ok: true });
    renderLanding({ localAuthAvailable: true });

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
    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        email: "owner@example.com",
        password: "correct horse battery", // pragma: allowlist secret
        redirect: false,
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/holdings"));
  });

  it("shows an inline error instead of navigating away on a failed local sign-in", async () => {
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });
    renderLanding({ localAuthAvailable: true });

    fireEvent.change(screen.getByLabelText(messages.Landing.emailLabel), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(messages.Landing.passwordLabel), {
      target: { value: "wrong-password" }, // pragma: allowlist secret
    });
    fireEvent.click(screen.getByRole("button", { name: messages.Landing.signIn }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Landing.loginError);
    expect(push).not.toHaveBeenCalled();
  });

  it("hides the SSO button, divider and Forgot? link when local auth is on", () => {
    renderLanding({ localAuthAvailable: true });

    expect(screen.queryByRole("button", { name: messages.Landing.sso })).not.toBeInTheDocument();
    expect(screen.queryByText(messages.Landing.orEmail)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.Landing.forgot })).not.toBeInTheDocument();
  });

  // Regression tests for #487: the demo "portfolio glance" figure was hardcoded to
  // Indonesian Rupiah/punctuation regardless of locale or the returning user's currency.
  it("defaults the demo figure to an Indonesian Rupiah example, formatted for the locale", () => {
    renderLanding();
    expect(screen.getByText("IDR 40,650,000")).toBeInTheDocument();
    expect(screen.getByText("▲ 18.2%")).toBeInTheDocument();
  });

  it("formats the demo figure in the returning user's currency", () => {
    renderLanding({ initialCurrency: "EUR" });
    expect(screen.getByText("€24,180")).toBeInTheDocument();
  });

  it("falls back to the Rupiah example for an unrecognized currency", () => {
    renderLanding({ initialCurrency: "XYZ" });
    expect(screen.getByText("IDR 40,650,000")).toBeInTheDocument();
  });

  // DEV_AUTH_TOKEN (PR #627) bypasses both the Authentik session cookie and the local-auth
  // form — with it active, the SSO button/email form are dead ends, so devBypass swaps them
  // for a plain entry link instead.
  it("renders a dev-entry link to /holdings instead of sign-in when devBypass is set", () => {
    renderLanding({ devBypass: true });

    const link = screen.getByRole("link", { name: messages.Landing.devEnter });
    expect(link).toHaveAttribute("href", "/holdings");
    expect(screen.queryByRole("button", { name: messages.Landing.sso })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.Landing.signIn })).not.toBeInTheDocument();
  });

  describe("first-run setup (needsSetup)", () => {
    it("renders the admin-account setup form instead of the sign-in form", () => {
      renderLanding({ localAuthAvailable: true, needsSetup: true });

      expect(
        screen.getByRole("heading", { name: messages.Landing.setupTitle }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(messages.Landing.setupConfirmLabel)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: messages.Landing.signIn }),
      ).not.toBeInTheDocument();
    });

    it("rejects a password/confirm mismatch before calling the API", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      renderLanding({ localAuthAvailable: true, needsSetup: true });

      fireEvent.change(screen.getByLabelText(messages.Landing.emailLabel), {
        target: { value: "admin@example.com" },
      });
      fireEvent.change(screen.getByLabelText(messages.Landing.passwordLabel), {
        target: { value: "bootstrap-password" }, // pragma: allowlist secret
      });
      fireEvent.change(screen.getByLabelText(messages.Landing.setupConfirmLabel), {
        target: { value: "different-password" }, // pragma: allowlist secret
      });
      fireEvent.click(screen.getByRole("button", { name: messages.Landing.setupSubmit }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        messages.Landing.setupPasswordMismatch,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("creates the account then signs in and navigates to /holdings", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      signInMock.mockResolvedValue({ error: undefined, ok: true });
      renderLanding({ localAuthAvailable: true, needsSetup: true });

      fireEvent.change(screen.getByLabelText(messages.Landing.emailLabel), {
        target: { value: "admin@example.com" },
      });
      fireEvent.change(screen.getByLabelText(messages.Landing.passwordLabel), {
        target: { value: "bootstrap-password" }, // pragma: allowlist secret
      });
      fireEvent.change(screen.getByLabelText(messages.Landing.setupConfirmLabel), {
        target: { value: "bootstrap-password" }, // pragma: allowlist secret
      });
      fireEvent.click(screen.getByRole("button", { name: messages.Landing.setupSubmit }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/local-auth-setup",
          expect.objectContaining({ method: "POST" }),
        ),
      );
      await waitFor(() =>
        expect(signInMock).toHaveBeenCalledWith("credentials", {
          email: "admin@example.com",
          password: "bootstrap-password", // pragma: allowlist secret
          redirect: false,
        }),
      );
      await waitFor(() => expect(push).toHaveBeenCalledWith("/holdings"));
      vi.unstubAllGlobals();
    });

    it("shows setupAlreadyDone when the API returns 409", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
      vi.stubGlobal("fetch", fetchMock);
      renderLanding({ localAuthAvailable: true, needsSetup: true });

      fireEvent.change(screen.getByLabelText(messages.Landing.emailLabel), {
        target: { value: "admin@example.com" },
      });
      fireEvent.change(screen.getByLabelText(messages.Landing.passwordLabel), {
        target: { value: "bootstrap-password" }, // pragma: allowlist secret
      });
      fireEvent.change(screen.getByLabelText(messages.Landing.setupConfirmLabel), {
        target: { value: "bootstrap-password" }, // pragma: allowlist secret
      });
      fireEvent.click(screen.getByRole("button", { name: messages.Landing.setupSubmit }));

      expect(await screen.findByRole("alert")).toHaveTextContent(messages.Landing.setupAlreadyDone);
      expect(signInMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
