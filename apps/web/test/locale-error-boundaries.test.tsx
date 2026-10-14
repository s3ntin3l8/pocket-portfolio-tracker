import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";
import LocaleError from "../src/app/[locale]/error";
import GlobalError from "../src/app/global-error";

// global-error owns <html>/<body>; React warns about nesting them inside the test container.
vi.spyOn(console, "error").mockImplementation(() => {});

describe("[locale] error boundary (landing / onboarding)", () => {
  it("shows the translated message, the digest and a retry — never the raw error message", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("secret internals"), { digest: "d1" });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <LocaleError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.Error.title)).toBeInTheDocument();
    expect(screen.getByText("REF · d1")).toBeInTheDocument();
    expect(screen.queryByText(/secret internals/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.Error.retry }));
    expect(reset).toHaveBeenCalled();
  });
});

describe("global error boundary", () => {
  it("renders English copy with retry and no provider", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("x")} reset={reset} />);
    expect(screen.getByText(messages.Error.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: messages.Error.retry }));
    expect(reset).toHaveBeenCalled();
  });

  const startUrl = window.location.pathname;
  afterEach(() => {
    // Restore even when an assertion throws, so the URL never leaks into the next test.
    window.history.pushState({}, "", startUrl);
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("switches to Indonesian when the URL locale prefix is /id", async () => {
    window.history.pushState({}, "", "/id/holdings");
    render(<GlobalError error={new Error("x")} reset={() => {}} />);
    expect(await screen.findByText(idMessages.Error.title)).toBeInTheDocument();
  });

  it.each(["id-ID", "in", "in-ID"])(
    "falls back to Indonesian for browser language %s when the URL has no locale",
    async (lang) => {
      vi.spyOn(window.navigator, "language", "get").mockReturnValue(lang);
      render(<GlobalError error={new Error("x")} reset={() => {}} />);
      expect(await screen.findByText(idMessages.Error.title)).toBeInTheDocument();
    },
  );
});
