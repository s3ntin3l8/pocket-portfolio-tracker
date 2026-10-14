import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const push = vi.fn();
const replace = vi.fn();
const setTheme = vi.fn();
let pathname = "/holdings";
let search = "";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme }),
}));

const listPortfolios = vi.fn();
const listAccountHolders = vi.fn();
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    globalSearch: vi.fn().mockResolvedValue({ instruments: [], transactions: [] }),
    listPortfolios,
    listAccountHolders,
  }),
}));

import { GlobalSearch } from "../src/components/global-search";
import { RECENT_PAGES_KEY } from "../src/lib/recent-pages";
import { isTypingContext, isOverlayOpen } from "../src/lib/shortcuts";

const s = messages.Search;
const n = messages.Nav;

function renderBar(props: { isAdmin?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GlobalSearch {...props} />
    </NextIntlClientProvider>,
  );
}

function press(key: string, init: KeyboardEventInit = {}, target: Element | Document = document) {
  fireEvent.keyDown(target, { key, ...init });
}

function openPalette() {
  fireEvent.click(screen.getByRole("button", { name: s.triggerLabel }));
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  setTheme.mockClear();
  listPortfolios.mockReset().mockResolvedValue([]);
  listAccountHolders.mockReset().mockResolvedValue([]);
  pathname = "/holdings";
  search = "";
  localStorage.clear();
});

const appended: Element[] = [];
function append<T extends Element>(el: T): T {
  document.body.appendChild(el);
  appended.push(el);
  return el;
}

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
});

describe("command bar groups", () => {
  it("lists every page under Go to, and hides Admin for non-admins", () => {
    renderBar();
    openPalette();
    const group = screen.getByRole("group", { name: s.groupNavigate });
    for (const label of [
      n.holdings,
      n.activity,
      n.reports,
      n.insights,
      n.income,
      n.tax,
      n.trades,
      n.savings,
      n.portfolios,
      n.settings,
    ]) {
      expect(within(group).getByText(label)).toBeInTheDocument();
    }
    expect(within(group).queryByText(n.admin)).not.toBeInTheDocument();
  });

  it("shows Admin for admins", () => {
    renderBar({ isAdmin: true });
    openPalette();
    expect(screen.getByText(n.admin)).toBeInTheDocument();
  });

  it("navigation keeps the scope in the URL", () => {
    search = "scope=p:abc";
    renderBar();
    openPalette();
    fireEvent.click(screen.getByText(n.tax));
    expect(push).toHaveBeenCalledWith("/tax?scope=p%3Aabc");
  });

  it("filters commands by the typed query", () => {
    renderBar();
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(s.placeholder), { target: { value: "inco" } });
    expect(screen.getByText(n.income)).toBeInTheDocument();
    expect(screen.queryByText(n.tax)).not.toBeInTheDocument();
  });

  it("Actions: add transaction pushes the entry deep link on the current page", () => {
    search = "scope=all";
    renderBar();
    openPalette();
    fireEvent.click(screen.getByText(s.actionAddTransaction));
    expect(push).toHaveBeenCalledWith("/holdings?scope=all&entry=transaction");
  });

  it("Actions: import and theme toggle", () => {
    renderBar();
    openPalette();
    fireEvent.click(screen.getByText(s.actionImport));
    expect(push).toHaveBeenCalledWith("/holdings?entry=import");

    openPalette();
    fireEvent.click(screen.getByText(s.actionToggleTheme));
    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("chart range is offered on Holdings only and replaces the URL", () => {
    renderBar();
    openPalette();
    fireEvent.click(screen.getByText(s.rangeTo.replace("{range}", messages.Chart.range["1m"])));
    expect(replace).toHaveBeenCalledWith("/holdings?range=1m");
  });

  it("the default range keeps a clean URL", () => {
    search = "range=1m";
    renderBar();
    openPalette();
    fireEvent.click(screen.getByText(s.rangeTo.replace("{range}", messages.Chart.range["1y"])));
    expect(replace).toHaveBeenCalledWith("/holdings");
  });

  it("no range group off the Holdings page", () => {
    pathname = "/tax";
    renderBar();
    openPalette();
    expect(screen.queryByRole("group", { name: s.groupRange })).not.toBeInTheDocument();
  });

  it("Recent lists previously visited pages except the current one", () => {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(["/holdings", "/tax"]));
    renderBar();
    openPalette();
    const recent = screen.getByRole("group", { name: s.groupRecent });
    expect(within(recent).getByText(n.tax)).toBeInTheDocument();
    expect(within(recent).queryByText(n.holdings)).not.toBeInTheDocument();
  });

  it("Switch scope lists portfolios once there are several, and pushes ?scope=", async () => {
    listPortfolios.mockResolvedValue([
      { id: "p1", name: "Alpha", accountHolderId: "h1" },
      { id: "p2", name: "Beta", accountHolderId: "h1" },
    ]);
    listAccountHolders.mockResolvedValue([{ id: "h1", name: "Sam" }]);
    renderBar();
    openPalette();
    const item = await screen.findByText(s.scopeTo.replace("{name}", "Beta"));
    expect(screen.getByText(s.scopeTo.replace("{name}", "Sam"))).toBeInTheDocument();
    fireEvent.click(item);
    expect(push).toHaveBeenCalledWith("/holdings?scope=p%3Ap2");
  });

  it("no scope group with a single portfolio", async () => {
    listPortfolios.mockResolvedValue([{ id: "p1", name: "Alpha", accountHolderId: null }]);
    renderBar();
    openPalette();
    await waitFor(() => expect(listPortfolios).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: s.groupScope })).not.toBeInTheDocument();
  });

  it("palette input has an accessible dialog and combobox", () => {
    renderBar();
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});

describe("single-key shortcuts", () => {
  it("g then h/a/r/i/s navigates, preserving scope", () => {
    search = "scope=all";
    renderBar();
    for (const [key, dest] of [
      ["h", "/holdings"],
      ["a", "/transactions"],
      ["r", "/reports"],
      ["i", "/insights"],
      ["s", "/settings"],
    ] as const) {
      push.mockClear();
      press("g");
      press(key);
      expect(push).toHaveBeenCalledWith(`${dest}?scope=all`);
    }
  });

  it("an unknown second key cancels the chord", () => {
    renderBar();
    press("g");
    press("z");
    press("h");
    expect(push).not.toHaveBeenCalled();
  });

  it("the chord expires", () => {
    vi.useFakeTimers();
    try {
      renderBar();
      press("g");
      vi.advanceTimersByTime(5000);
      press("h");
      expect(push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("n opens the add-transaction entry", () => {
    renderBar();
    press("n");
    expect(push).toHaveBeenCalledWith("/holdings?entry=transaction");
  });

  it("/ opens the palette", () => {
    renderBar();
    press("/");
    expect(screen.getByPlaceholderText(s.placeholder)).toBeInTheDocument();
  });

  it("? shows the shortcuts help with every shortcut and closes on Escape", () => {
    renderBar();
    press("?", { shiftKey: true });
    const dialog = screen.getByRole("dialog", { name: s.shortcutsTitle });
    expect(within(dialog).getByText(s.shortcutNewTransaction)).toBeInTheDocument();
    expect(within(dialog).getByText(n.holdings)).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the help sheet is reachable from the palette", () => {
    renderBar();
    openPalette();
    fireEvent.click(screen.getByText(s.actionShortcuts));
    expect(screen.getByRole("dialog", { name: s.shortcutsTitle })).toBeInTheDocument();
  });

  it("ignores modified keys (browser/OS shortcuts)", () => {
    renderBar();
    press("n", { ctrlKey: true });
    press("n", { metaKey: true });
    press("n", { altKey: true });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("typing-context guard", () => {
  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    ["select", () => document.createElement("select")],
    [
      "contenteditable",
      () => {
        const el = document.createElement("div");
        el.setAttribute("contenteditable", "true");
        // jsdom has no isContentEditable; the attribute fallback must cover it.
        return el;
      },
    ],
    [
      "role=textbox",
      () => {
        const el = document.createElement("div");
        el.setAttribute("role", "textbox");
        el.tabIndex = 0;
        return el;
      },
    ],
  ])("does not fire shortcuts from a %s", (_name, make) => {
    renderBar();
    const el = make();
    append(el);
    el.focus();
    press("n", {}, el);
    press("g", {}, el);
    press("h", {}, el);
    press("/", {}, el);
    press("?", {}, el);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not fire while another dialog is open", () => {
    renderBar();
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    append(dlg);
    press("n");
    press("g");
    press("h");
    expect(push).not.toHaveBeenCalled();
  });

  it("typing in the palette input never triggers shortcuts, and does not trap Escape", () => {
    renderBar();
    openPalette();
    const input = screen.getByPlaceholderText(s.placeholder);
    input.focus();
    press("n", {}, input);
    press("g", {}, input);
    press("h", {}, input);
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText(s.placeholder)).not.toBeInTheDocument();
  });

  it("Cmd/Ctrl-K still toggles the palette from inside a field", () => {
    renderBar();
    const input = document.createElement("input");
    append(input);
    input.focus();
    press("k", { ctrlKey: true }, input);
    expect(screen.getByPlaceholderText(s.placeholder)).toBeInTheDocument();
  });

  it("helpers: isTypingContext / isOverlayOpen", () => {
    expect(isTypingContext(null)).toBe(false);
    expect(isTypingContext(document.createElement("button"))).toBe(false);
    expect(isTypingContext(document.createElement("input"))).toBe(true);
    expect(isOverlayOpen()).toBe(false);
  });
});
