import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useTheme } from "next-themes";
import messages from "../messages/en.json";
import { ThemeTogglePill } from "@/components/onboarding/theme-toggle-pill";

vi.mock("next-themes", () => ({ useTheme: vi.fn() }));

const setTheme = vi.fn();

function renderPill(resolvedTheme: "light" | "dark") {
  vi.mocked(useTheme).mockReturnValue({
    resolvedTheme,
    setTheme,
    theme: resolvedTheme,
    themes: ["light", "dark"],
    systemTheme: resolvedTheme,
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeTogglePill />
    </NextIntlClientProvider>,
  );
}

describe("ThemeTogglePill", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders a labelled light/dark group with the resolved theme active", () => {
    renderPill("dark");
    expect(
      screen.getByRole("radiogroup", { name: messages.Onboarding.themeLabel }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: messages.Onboarding.themeDark })).toBeChecked();
    expect(screen.getByRole("radio", { name: messages.Onboarding.themeLight })).not.toBeChecked();
  });

  it("switches to the other theme explicitly", () => {
    renderPill("dark");
    fireEvent.click(screen.getByRole("radio", { name: messages.Onboarding.themeLight }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("ignores a click on the already-active item", () => {
    renderPill("light");
    fireEvent.click(screen.getByRole("radio", { name: messages.Onboarding.themeLight }));
    expect(setTheme).not.toHaveBeenCalled();
  });
});
