import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import id from "../messages/id.json";
import {
  CountrySelect,
  countryOptions,
} from "../src/components/portfolio-form-dialog/sections/country-select";

describe("countryOptions", () => {
  it("lists every ISO country by its localized name, sorted by that name", () => {
    const en = countryOptions("en", "");
    expect(en).toHaveLength(249);
    expect(en.find((o) => o.code === "DE")!.name).toBe("Germany");
    const names = en.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(countryOptions("id", "").find((o) => o.code === "DE")!.name).toBe("Jerman");
  });

  it("keeps a stored code that isn't in the list selectable", () => {
    const opts = countryOptions("en", "XK");
    expect(opts).toHaveLength(250);
    expect(opts.at(-1)).toEqual({ code: "XK", name: "XK" });
  });

  it("falls back to the code when the locale can't name regions", () => {
    const opts = countryOptions("not a locale!", "");
    expect(opts.find((o) => o.code === "ID")!.name).toBe("ID");
  });
});

describe("CountrySelect", () => {
  it("renders the 'not set' option, the localized names, and reports a change", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="id" messages={id}>
        <CountrySelect id="c" value="" onChange={onChange} />
      </NextIntlClientProvider>,
    );
    const select = screen.getByLabelText(id.PortfolioForm.country) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0]!.textContent).toBe(id.PortfolioForm.countryNone);
    expect(screen.getByRole("option", { name: "Indonesia" })).toHaveValue("ID");
    fireEvent.change(select, { target: { value: "ID" } });
    expect(onChange).toHaveBeenCalledWith("ID");
  });

  it("shows a stored code outside the list as selected", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CountrySelect id="c" value="XK" onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    const select = screen.getByLabelText(en.PortfolioForm.country) as HTMLSelectElement;
    expect(select.value).toBe("XK");
    expect(select.options).toHaveLength(251);
  });

  it("describes the select with the tax hint", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CountrySelect id="c" value="ID" onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText(en.PortfolioForm.country)).toHaveAccessibleDescription(
      en.PortfolioForm.countryHint,
    );
  });
});
