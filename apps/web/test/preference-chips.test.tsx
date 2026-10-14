import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
const putPreferences = vi.fn(async (body: unknown) => body);

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ putPreferences }),
}));

import { PreferenceChips } from "../src/components/preference-chips";

describe("PreferenceChips", () => {
  beforeEach(() => {
    refresh.mockClear();
    putPreferences.mockClear();
  });

  it("marks the current value's chip as active", () => {
    render(
      <PreferenceChips
        prefKey="taxRegime"
        current="DE"
        options={[
          { value: "DE", label: "Germany" },
          { value: "ID", label: "Indonesia" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Germany" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Indonesia" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("persists taxRegime and refreshes the route when a different chip is clicked", async () => {
    render(
      <PreferenceChips
        prefKey="taxRegime"
        current="DE"
        options={[
          { value: "DE", label: "Germany" },
          { value: "ID", label: "Indonesia" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Indonesia" }));
    await waitFor(() => expect(putPreferences).toHaveBeenCalledWith({ taxRegime: "ID" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("persists costBasisMode under its own key, not taxRegime", async () => {
    render(
      <PreferenceChips
        prefKey="costBasisMode"
        current="purchase_price"
        options={[
          { value: "purchase_price", label: "Purchase price" },
          { value: "total_paid", label: "Total paid" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Total paid" }));
    await waitFor(() =>
      expect(putPreferences).toHaveBeenCalledWith({ costBasisMode: "total_paid" }),
    );
  });

  it("does not persist or refresh when clicking the already-active chip", () => {
    render(
      <PreferenceChips
        prefKey="taxRegime"
        current="DE"
        options={[
          { value: "DE", label: "Germany" },
          { value: "ID", label: "Indonesia" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Germany" }));
    expect(putPreferences).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
