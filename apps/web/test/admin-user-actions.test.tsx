import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const adminRevokeUserTokens = vi.fn(async () => ({ revoked: 2 }));
const adminResetUserOnboarding = vi.fn(async () => undefined);
const adminDeleteUser = vi.fn(async () => undefined);
const routerRefresh = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ adminRevokeUserTokens, adminResetUserOnboarding, adminDeleteUser }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

const { AdminUserActions } = await import("../src/components/admin-user-actions");

const m = messages.Admin;

function renderActions(onboardingCompleted = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminUserActions
        userId="u1"
        email="andhika@email.com"
        onboardingCompleted={onboardingCompleted}
      />
    </NextIntlClientProvider>,
  );
}

// Radix opens its dropdown on keyboard/pointer events, not a synthetic click; Enter on
// the focused trigger is the most reliable opener under jsdom (see portfolio-card-menu).
function openMenu() {
  const trigger = screen.getByRole("button", { name: m.usersActions });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("AdminUserActions", () => {
  it("opens a kebab menu with all three actions when onboarding is complete", () => {
    renderActions(true);
    openMenu();
    expect(screen.getByRole("menuitem", { name: m.revokeTokens })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: m.resetOnboarding })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: m.deleteUser })).toBeInTheDocument();
  });

  it("omits 'Reset onboarding' when onboarding hasn't been completed", () => {
    renderActions(false);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: m.resetOnboarding })).toBeNull();
  });

  it("revokes tokens without requiring typed confirmation", async () => {
    renderActions();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: m.revokeTokens }));

    // Confirm dialog opens with the user's email shown.
    await waitFor(() => expect(screen.getAllByText("andhika@email.com").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: m.revokeTokens }));

    await waitFor(() => expect(adminRevokeUserTokens).toHaveBeenCalledWith("u1"));
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("resets onboarding without requiring typed confirmation", async () => {
    renderActions();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: m.resetOnboarding }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: m.resetOnboarding })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: m.resetOnboarding }));

    await waitFor(() => expect(adminResetUserOnboarding).toHaveBeenCalledWith("u1"));
  });

  it("requires typing 'Delete' before the delete-user button is enabled", async () => {
    renderActions();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: m.deleteUser }));

    await waitFor(() => expect(screen.getByText(m.confirmActionTypeToConfirm)).toBeInTheDocument());
    const confirmButton = screen.getByRole("button", { name: m.deleteUser });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(m.confirmActionInputPlaceholder), {
      target: { value: "Delete" },
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(adminDeleteUser).toHaveBeenCalledWith("u1"));
  });
});
