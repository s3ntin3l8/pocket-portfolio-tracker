import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace }),
}));

import { LocaleSwitcher } from "../src/components/locale-switcher";

describe("LocaleSwitcher", () => {
  it("exposes the languages as a radiogroup and switches locale on select", () => {
    replace.mockClear();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <LocaleSwitcher />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("radiogroup", { name: messages.Settings.language }),
    ).toBeInTheDocument();
    const en = screen.getByRole("radio", { name: messages.Settings.languageOptions.en });
    const id = screen.getByRole("radio", { name: messages.Settings.languageOptions.id });
    expect(en).toHaveAttribute("aria-checked", "true");
    expect(id).toHaveAttribute("aria-checked", "false");

    fireEvent.click(en);
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(id);
    expect(replace).toHaveBeenCalledWith("/settings", { locale: "id" });
  });
});
