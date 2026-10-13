import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/tax",
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));

import { PeriodSelect } from "../src/components/period-select";

function renderSelect(value = "2026") {
  return render(
    <PeriodSelect
      label="Tax year"
      value={value}
      defaultValue="2026"
      options={["2026", "2025", "2024"]}
    />,
  );
}

describe("PeriodSelect", () => {
  beforeEach(() => {
    replace.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  it("reflects the period the server rendered", () => {
    renderSelect("2025");
    expect(screen.getByLabelText("Tax year")).toHaveValue("2025");
  });

  it("writes ?year= with router.replace (no scroll jump), keeping other params", () => {
    mockSearchParams = new URLSearchParams("scope=p:p1");
    renderSelect();
    fireEvent.change(screen.getByLabelText("Tax year"), { target: { value: "2024" } });
    expect(replace).toHaveBeenCalledWith("/tax?scope=p%3Ap1&year=2024", { scroll: false });
  });

  it("drops the param when the default period is picked", () => {
    mockSearchParams = new URLSearchParams("year=2024");
    renderSelect("2024");
    fireEvent.change(screen.getByLabelText("Tax year"), { target: { value: "2026" } });
    expect(replace).toHaveBeenCalledWith("/tax", { scroll: false });
  });
});
