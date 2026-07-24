import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import type { AdminUser } from "@portfolio/api-client";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

// AdminUserActions (the kebab menu) has its own dedicated test — stub it here so this
// file stays focused on the table/pill rendering. Uses `userId` (not `email`, which the
// row already renders) as the test-id suffix to avoid a duplicate-text collision.
vi.mock("@/components/admin-user-actions", () => ({
  AdminUserActions: ({
    userId,
    onboardingCompleted,
  }: {
    userId: string;
    onboardingCompleted: boolean;
  }) => (
    <div data-testid={`user-actions-${userId}`} data-onboarding-completed={onboardingCompleted} />
  ),
}));

const { AdminUsersTable } = await import("../src/components/admin-users-table");

function user(overrides: Partial<AdminUser> & Pick<AdminUser, "id" | "email">): AdminUser {
  return {
    name: null,
    createdAt: "2026-01-12T00:00:00.000Z",
    onboardingCompletedAt: "2026-01-12T00:00:00.000Z",
    portfolioCount: 0,
    transactionCount: 0,
    documentCount: 0,
    storageBytes: 0,
    tokenCount: 0,
    ...overrides,
  };
}

async function renderTable(users: AdminUser[]) {
  const el = await AdminUsersTable({ users });
  return render(el as React.ReactElement);
}

describe("AdminUsersTable", () => {
  it("shows the empty state when there are no users", async () => {
    await renderTable([]);
    expect(screen.getByText("usersNoUsers")).toBeInTheDocument();
  });

  it("renders one card row per user (not a table)", async () => {
    await renderTable([
      user({ id: "a", email: "andhika@email.com" }),
      user({ id: "b", email: "sarah.chen@email.com" }),
    ]);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("andhika@email.com")).toBeInTheDocument();
    expect(screen.getByText("sarah.chen@email.com")).toBeInTheDocument();
  });

  it("shows an em dash for a user with no name", async () => {
    await renderTable([user({ id: "a", email: "devbot@email.com", name: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows stat pills for portfolios/transactions/documents/storage/tokens", async () => {
    await renderTable([
      user({
        id: "a",
        email: "andhika@email.com",
        portfolioCount: 3,
        transactionCount: 412,
        documentCount: 8,
        storageBytes: 2_516_582, // ~2.4 MB
        tokenCount: 2,
      }),
    ]);
    expect(screen.getByText("3 usersPortfolios")).toBeInTheDocument();
    expect(screen.getByText("412 usersTransactions")).toBeInTheDocument();
    expect(screen.getByText("8 usersDocuments")).toBeInTheDocument();
    expect(screen.getByText("2.4 MB")).toBeInTheDocument();
    expect(screen.getByText("2 usersTokens")).toBeInTheDocument();
  });

  it("derives onboardingCompleted from onboardingCompletedAt (null → false)", async () => {
    await renderTable([
      user({ id: "a", email: "done@email.com", onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      user({ id: "b", email: "pending@email.com", onboardingCompletedAt: null }),
    ]);
    expect(screen.getByTestId("user-actions-a")).toHaveAttribute(
      "data-onboarding-completed",
      "true",
    );
    expect(screen.getByTestId("user-actions-b")).toHaveAttribute(
      "data-onboarding-completed",
      "false",
    );
  });
});
