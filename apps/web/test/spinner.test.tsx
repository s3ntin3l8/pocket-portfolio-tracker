import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { Spinner } from "../src/components/ui/spinner";

// The spinner names itself from the catalogue, so it needs the intl provider.
function renderSpinner(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Spinner", () => {
  it("renders a spinning icon at the default (md) size", () => {
    const { container } = renderSpinner(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("animate-spin", "size-5");
  });

  it("supports size variants", () => {
    const { container: md } = renderSpinner(<Spinner size="md" />);
    expect(md.querySelector("svg")).toHaveClass("size-5");
    const { container: lg } = renderSpinner(<Spinner size="lg" />);
    expect(lg.querySelector("svg")).toHaveClass("size-6");
    const { container: xl } = renderSpinner(<Spinner size="xl" />);
    expect(xl.querySelector("svg")).toHaveClass("size-7");
  });

  it("merges a caller className", () => {
    const { container } = renderSpinner(<Spinner className="text-destructive" />);
    expect(container.querySelector("svg")).toHaveClass("text-destructive");
  });
});
