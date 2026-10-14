import { describe, it, expect, vi } from "vitest";
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

  it("switches to Indonesian when the URL locale prefix is /id", async () => {
    window.history.pushState({}, "", "/id/holdings");
    render(<GlobalError error={new Error("x")} reset={() => {}} />);
    expect(await screen.findByText(idMessages.Error.title)).toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });
});
