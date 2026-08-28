import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type * as React from "react";
import messages from "../messages/en.json";

const refresh = vi.fn();

// AccountSection nests several client components (UpdateProfile, DisplayCurrency,
// ChangePassword) that pull a session-aware api-client via useApiClient — stub it so
// this test doesn't need a SessionProvider, matching settings-sections.test.tsx.
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    updateMe: vi.fn(),
    changeLocalPassword: vi.fn(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/settings",
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Identity translator, same convention as settings-sections.test.tsx / admin-stats.test.tsx
// — AccountSection's own server-rendered labels (SectionLabel, the authVia line) are
// asserted against the echoed key, not real copy. Params (e.g. authVia's {email}) are
// dropped, same as the shared pattern.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async (namespace?: string) => {
    const t = (key: string) => `${namespace ?? ""}.${key}`;
    return t;
  }),
}));

const { AccountSection } = await import("../src/components/settings-sections/account-section");

const ME = {
  name: "Björn",
  displayCurrency: "IDR",
  email: "owner@example.com",
  authSub: "local|owner@example.com",
};

function renderWithIntl(element: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe("AccountSection — Password card", () => {
  it("renders the Password card when local auth is available", async () => {
    const element = await AccountSection({ me: ME, localAuthAvailable: true });
    renderWithIntl(element as React.ReactElement);

    expect(screen.getByText("Settings.password")).toBeInTheDocument();
    // The submit button's own text comes from the real client-side messages (this
    // component uses useTranslations, backed by NextIntlClientProvider above) —
    // unaffected by the server-side identity mock.
    expect(
      screen.getByRole("button", { name: messages.Settings.changePassword }),
    ).toBeInTheDocument();
  });

  it("omits the Password card when local auth isn't configured", async () => {
    const element = await AccountSection({ me: ME, localAuthAvailable: false });
    renderWithIntl(element as React.ReactElement);

    expect(screen.queryByText("Settings.password")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: messages.Settings.changePassword }),
    ).not.toBeInTheDocument();
  });

  it("shows the local-password auth-method line for a local|<email> authSub", async () => {
    const element = await AccountSection({ me: ME, localAuthAvailable: true });
    renderWithIntl(element as React.ReactElement);

    expect(screen.getByText("Settings.authViaLocal")).toBeInTheDocument();
    expect(screen.queryByText("Settings.authVia")).not.toBeInTheDocument();
  });

  it("shows the Authentik auth-method line for a non-local authSub", async () => {
    const oidcMe = { ...ME, authSub: "some-authentik-sub" };
    const element = await AccountSection({ me: oidcMe, localAuthAvailable: true });
    renderWithIntl(element as React.ReactElement);

    expect(screen.getByText("Settings.authVia")).toBeInTheDocument();
    expect(screen.queryByText("Settings.authViaLocal")).not.toBeInTheDocument();
  });
});
