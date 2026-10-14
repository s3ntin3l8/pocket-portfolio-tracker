import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "../src/app/[locale]/(app)/reports/documents/loading";

describe("reports/documents loading skeleton", () => {
  it("renders an aria-hidden placeholder with skeleton blocks", () => {
    render(<Loading />);
    const root = screen.getByTestId("reports-documents-loading");

    expect(root).toHaveAttribute("aria-hidden", "true");
    // Each Skeleton renders one aria-hidden shimmer overlay; count those, not styling classes.
    expect(root.querySelectorAll("[aria-hidden]").length).toBeGreaterThan(5);
  });
});
