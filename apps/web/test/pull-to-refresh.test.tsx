import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React, { createRef } from "react";
import { PullToRefresh } from "../src/components/pull-to-refresh";

// Mock i18n navigation router
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("PullToRefresh", () => {
  it("renders children successfully", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    const { getByText } = render(
      <div ref={scrollContainerRef}>
        <PullToRefresh scrollContainerRef={scrollContainerRef}>
          <div>content to refresh</div>
        </PullToRefresh>
      </div>
    );

    expect(getByText("content to refresh")).toBeInTheDocument();
  });
});
