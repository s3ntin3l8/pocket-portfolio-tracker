import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { ShortcutsToggle } from "../src/components/shortcuts-toggle";
import { SHORTCUTS_DISABLED_KEY } from "../src/lib/shortcut-preference";

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShortcutsToggle />
    </NextIntlClientProvider>,
  );
}

describe("ShortcutsToggle", () => {
  beforeEach(() => localStorage.clear());

  it("is on by default and persists turning it off and on", () => {
    renderToggle();
    const sw = screen.getByRole("switch", { name: messages.Settings.shortcutsLabel });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
    expect(localStorage.getItem(SHORTCUTS_DISABLED_KEY)).toBe("1");
    fireEvent.click(sw);
    expect(localStorage.getItem(SHORTCUTS_DISABLED_KEY)).toBeNull();
  });

  it("reflects a stored opt-out", () => {
    localStorage.setItem(SHORTCUTS_DISABLED_KEY, "1");
    renderToggle();
    expect(
      screen.getByRole("switch", { name: messages.Settings.shortcutsLabel }),
    ).not.toBeChecked();
  });
});
