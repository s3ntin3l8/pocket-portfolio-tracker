import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Loading from "../src/app/[locale]/(app)/reports/documents/loading";

describe("reports/documents loading skeleton", () => {
  it("renders an aria-hidden placeholder with skeleton blocks", () => {
    const { container } = render(<Loading />);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.querySelectorAll(".bg-muted").length).toBeGreaterThan(5);
  });
});
