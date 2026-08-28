import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ApiError } from "@portfolio/api-client";
import {
  ChangePasswordForm,
  type ChangePasswordClient,
} from "../src/components/change-password-form";
import messages from "../messages/en.json";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: signInMock }));

const EMAIL = "owner@example.com";

function renderForm(client: ChangePasswordClient) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChangePasswordForm client={client} email={EMAIL} />
    </NextIntlClientProvider>,
  );
}

function fillAndSubmit(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(messages.Settings.currentPasswordLabel), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText(messages.Settings.newPasswordLabel), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText(messages.Settings.confirmNewPasswordLabel), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: messages.Settings.changePassword }));
}

describe("ChangePasswordForm", () => {
  beforeEach(() => signInMock.mockReset());

  it("disables submit until both current and new password are filled", () => {
    const client: ChangePasswordClient = { changeLocalPassword: vi.fn() };
    renderForm(client);

    const submit = screen.getByRole("button", { name: messages.Settings.changePassword });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(messages.Settings.currentPasswordLabel), {
      target: { value: "old-password" }, // pragma: allowlist secret
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(messages.Settings.newPasswordLabel), {
      target: { value: "new-password-1" }, // pragma: allowlist secret
    });
    expect(submit).toBeEnabled();
  });

  it("changes the password, silently re-authenticates, and shows a success state", async () => {
    const client: ChangePasswordClient = {
      changeLocalPassword: vi.fn(async () => ({ ok: true as const })),
    };
    signInMock.mockResolvedValue({ error: undefined, ok: true });
    renderForm(client);

    fillAndSubmit(
      "old-password", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
    );

    await waitFor(() =>
      expect(screen.getByText(messages.Settings.passwordChanged)).toBeInTheDocument(),
    );
    expect(client.changeLocalPassword).toHaveBeenCalledWith({
      currentPassword: "old-password", // pragma: allowlist secret
      newPassword: "new-password-1", // pragma: allowlist secret
    });
    // The change just revoked this session's own local JWT (passwordChangedAt) — without
    // re-authenticating, the very next API call would 401 and bounce the user to sign-in
    // right after a successful change.
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: EMAIL,
      password: "new-password-1", // pragma: allowlist secret
      redirect: false,
    });
  });

  it("shows reauthFailed when the password changes but silent re-auth fails", async () => {
    const client: ChangePasswordClient = {
      changeLocalPassword: vi.fn(async () => ({ ok: true as const })),
    };
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });
    renderForm(client);

    fillAndSubmit(
      "old-password", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.Settings.changePasswordErrors.reauthFailed,
    );
    expect(screen.queryByText(messages.Settings.passwordChanged)).not.toBeInTheDocument();
  });

  it("rejects a confirm-password mismatch before calling the API", async () => {
    const client: ChangePasswordClient = { changeLocalPassword: vi.fn() };
    renderForm(client);

    fillAndSubmit(
      "old-password", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
      "different-password", // pragma: allowlist secret
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Settings.passwordMismatch);
    expect(client.changeLocalPassword).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("rejects a new password shorter than the minimum before calling the API", async () => {
    const client: ChangePasswordClient = { changeLocalPassword: vi.fn() };
    renderForm(client);

    fillAndSubmit("old-password", "short", "short"); // pragma: allowlist secret

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(client.changeLocalPassword).not.toHaveBeenCalled();
  });

  it("maps a 401 'Invalid password' response to a specific message", async () => {
    const client: ChangePasswordClient = {
      changeLocalPassword: vi.fn(async () => {
        throw new ApiError(401, JSON.stringify({ error: "Invalid password" }));
      }),
    };
    renderForm(client);

    fillAndSubmit(
      "wrong-password", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.Settings.changePasswordErrors["Invalid password"],
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("maps a 400 'no_local_password_set' response to a specific message", async () => {
    const client: ChangePasswordClient = {
      changeLocalPassword: vi.fn(async () => {
        throw new ApiError(400, JSON.stringify({ error: "no_local_password_set" }));
      }),
    };
    renderForm(client);

    fillAndSubmit(
      "anything", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.Settings.changePasswordErrors.no_local_password_set,
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic error for an unrecognized failure", async () => {
    const client: ChangePasswordClient = {
      changeLocalPassword: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    renderForm(client);

    fillAndSubmit(
      "old-password", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
      "new-password-1", // pragma: allowlist secret
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.Settings.changePasswordErrors.generic,
    );
  });
});
