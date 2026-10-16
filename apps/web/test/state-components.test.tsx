import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Inbox } from "lucide-react";
import messages from "../messages/en.json";
import { EmptyState } from "../src/components/empty-state";
import { ErrorBanner } from "../src/components/ui/error-banner";
import { FormField } from "../src/components/ui/form-field";
import InstrumentError from "../src/app/[locale]/(app)/instruments/[id]/error";

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("EmptyState", () => {
  it("renders the framed full-region form by default", () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="Nothing here" description="Add one" />,
    );
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByText("Add one")).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain("border-dashed");
  });

  it("renders the compact form without a frame and with no description", () => {
    const { container } = render(<EmptyState compact icon={Inbox} title="No matches" />);
    expect(screen.getByRole("heading", { name: "No matches" })).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain("border-dashed");
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("ErrorBanner", () => {
  it("is an alert with an icon and the message", () => {
    const { container } = render(<ErrorBanner>Could not save</ErrorBanner>);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("FormField", () => {
  it("associates the label with the control when an id is given", () => {
    render(
      <FormField id="amount" label="Amount">
        <input id="amount" />
      </FormField>,
    );
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });
});

describe("instrument error boundary", () => {
  it("shows the translated frame and the digest, never the raw error message", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("secret internal detail"), { digest: "abc123" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    wrap(<InstrumentError error={error} reset={reset} />);
    expect(screen.queryByText(/secret internal detail/)).toBeNull();
    expect(screen.getByText("REF · abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: messages.Error.retry }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
