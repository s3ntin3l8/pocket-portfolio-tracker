import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import AppError from "../src/app/[locale]/(app)/error";

describe("(app) error boundary", () => {
  it("shows the translated message, the digest and a retry — never the raw error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const error = Object.assign(new Error("db password=hunter2 leaked"), { digest: "abc123" });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AppError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.Error.title)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.queryByText(/hunter2/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.Error.retry }));
    expect(reset).toHaveBeenCalled();
  });
});
