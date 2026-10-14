import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const push = vi.fn();
const assistantOpen = vi.fn();
let assistantAvailable = false;

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/holdings",
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    globalSearch: vi.fn().mockResolvedValue({ instruments: [], transactions: [] }),
  }),
}));
vi.mock("@/components/assistant/assistant-provider", () => ({
  useAssistant: () => ({ available: assistantAvailable, open: assistantOpen }),
}));

import { GlobalSearch } from "../src/components/global-search";
import { RECENT_INSTRUMENTS_KEY } from "../src/lib/recent-instruments";
import { SHORTCUTS_DISABLED_KEY } from "../src/lib/shortcut-preference";

const s = messages.Search;

function renderSearch() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GlobalSearch />
    </NextIntlClientProvider>,
  );
}
const openPalette = () => fireEvent.click(screen.getByRole("button", { name: s.triggerLabel }));

describe("GlobalSearch — recent instruments", () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  it("lists recently opened instruments (symbol only) and navigates to them", () => {
    localStorage.setItem(RECENT_INSTRUMENTS_KEY, JSON.stringify([{ id: "i-1", symbol: "BBCA" }]));
    renderSearch();
    openPalette();
    fireEvent.click(screen.getByRole("option", { name: "BBCA" }));
    expect(push).toHaveBeenCalledWith("/instruments/i-1");
  });

  it("hides recent instruments once a query is typed", () => {
    localStorage.setItem(RECENT_INSTRUMENTS_KEY, JSON.stringify([{ id: "i-1", symbol: "BBCA" }]));
    renderSearch();
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(s.placeholder), { target: { value: "zzz" } });
    expect(screen.queryByRole("option", { name: "BBCA" })).not.toBeInTheDocument();
  });
});

describe("GlobalSearch — assistant fallback", () => {
  beforeEach(() => assistantOpen.mockClear());

  async function typeQuery(q: string) {
    openPalette();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(s.placeholder), { target: { value: q } });
    });
  }

  it("offers 'Ask the assistant' for a free-text query and opens it with the query", async () => {
    assistantAvailable = true;
    renderSearch();
    await typeQuery("why did my portfolio drop");
    fireEvent.click(
      screen.getByRole("option", { name: "Ask the assistant: why did my portfolio drop" }),
    );
    expect(assistantOpen).toHaveBeenCalledWith("why did my portfolio drop");
  });

  it("is absent without a query or when the assistant is unavailable", async () => {
    assistantAvailable = true;
    const { unmount } = renderSearch();
    openPalette();
    expect(screen.queryByText(/Ask the assistant/)).not.toBeInTheDocument();
    unmount();
    assistantAvailable = false;
    renderSearch();
    await typeQuery("hello");
    expect(screen.queryByText(/Ask the assistant/)).not.toBeInTheDocument();
  });
});

describe("GlobalSearch — shortcut opt-out", () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  it("single-key shortcuts work by default", () => {
    renderSearch();
    fireEvent.keyDown(document, { key: "/" });
    expect(screen.getByPlaceholderText(s.placeholder)).toBeInTheDocument();
  });

  it("are ignored when disabled, but Cmd/Ctrl-K still opens the palette", () => {
    localStorage.setItem(SHORTCUTS_DISABLED_KEY, "1");
    renderSearch();
    fireEvent.keyDown(document, { key: "/" });
    fireEvent.keyDown(document, { key: "n" });
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "h" });
    fireEvent.keyDown(document, { key: "?" });
    expect(screen.queryByPlaceholderText(s.placeholder)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(s.placeholder)).toBeInTheDocument();
  });
});
