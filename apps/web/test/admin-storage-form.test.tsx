import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AdminStorageResponse } from "@portfolio/api-client";
import messages from "../messages/en.json";

// Resolves to a valid full response by default (not the raw patch) — the component reads
// `updated.s3`/`.folder`/`.activeProvider` off the result to rebaseline its state.
const updateAdminStorageProviders = vi.fn(async () => initial());
const setAdminStorageS3Secret = vi.fn();
const clearAdminStorageS3Secret = vi.fn();
const testAdminStorageProvider = vi.fn();
const routerRefresh = vi.fn();

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    updateAdminStorageProviders,
    setAdminStorageS3Secret,
    clearAdminStorageS3Secret,
    testAdminStorageProvider,
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const { AdminStorageForm } = await import("../src/components/admin-storage-form");

const m = messages.Admin;

function initial(overrides: Partial<AdminStorageResponse> = {}): AdminStorageResponse {
  return {
    activeProvider: "folder",
    activeProviderSource: "db",
    s3: {
      endpoint: "",
      endpointSource: "db",
      region: "",
      regionSource: "db",
      bucket: "",
      bucketSource: "db",
      accessKeyId: "",
      accessKeyIdSource: "db",
      forcePathStyle: false,
      forcePathStyleSource: "db",
      signedUrlTtl: 3600,
      signedUrlTtlSource: "db",
      hasSecret: false,
      secretHint: "",
      secretSource: "db", // pragma: allowlist secret
    },
    folder: { path: "/data/storage", pathSource: "db" },
    encryptionEnabled: true,
    ...overrides,
  };
}

function renderForm(props: AdminStorageResponse) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdminStorageForm initial={props} />
    </NextIntlClientProvider>,
  );
}

describe("AdminStorageForm", () => {
  it("shows the folder path field for the local-folder provider by default", () => {
    renderForm(initial());
    expect(screen.getByDisplayValue("/data/storage")).toBeInTheDocument();
    expect(screen.queryByText(m.storageEndpoint)).toBeNull();
  });

  it("switches to the S3 field set via the provider select", () => {
    renderForm(initial());
    fireEvent.change(screen.getByLabelText(m.storageProvider), { target: { value: "s3" } });
    expect(screen.getByText(m.storageEndpoint)).toBeInTheDocument();
    expect(screen.queryByText(m.storageFolderPath)).toBeNull();
  });

  it("preserves edited S3 field state across folder→S3→folder→S3 switches (s3/folder state lives in the parent, not the conditionally-rendered block)", () => {
    renderForm(initial());
    const select = screen.getByLabelText(m.storageProvider);

    fireEvent.change(select, { target: { value: "s3" } });
    fireEvent.change(screen.getByPlaceholderText(m.storageEndpointPlaceholder), {
      target: { value: "https://s3.eu-central-1.amazonaws.com" },
    });

    fireEvent.change(select, { target: { value: "folder" } });
    expect(screen.queryByDisplayValue("https://s3.eu-central-1.amazonaws.com")).toBeNull();

    fireEvent.change(select, { target: { value: "s3" } });
    expect(screen.getByDisplayValue("https://s3.eu-central-1.amazonaws.com")).toBeInTheDocument();
  });

  it("ignores an out-of-range provider value rather than casting it blindly", () => {
    renderForm(initial());
    const select = screen.getByLabelText(m.storageProvider) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "not-a-real-provider" } });
    // Falls back to whatever was already selected — the folder field is still shown.
    expect(screen.getByDisplayValue("/data/storage")).toBeInTheDocument();
  });

  it("warns when saving to a folder without encryption configured", () => {
    renderForm(initial({ encryptionEnabled: false }));
    expect(screen.getByText(m.storageEncryptionRequired)).toBeInTheDocument();
  });

  it("saves the current settings and shows a saved indicator", async () => {
    renderForm(initial());
    fireEvent.click(screen.getByRole("button", { name: m.storageSave }));

    await waitFor(() => expect(updateAdminStorageProviders).toHaveBeenCalled());
    expect(updateAdminStorageProviders).toHaveBeenCalledWith(
      expect.objectContaining({ activeProvider: "folder", folderPath: "/data/storage" }),
    );
    expect(await screen.findByText(m.saved)).toBeInTheDocument();
  });

  it("shows an error when save fails", async () => {
    updateAdminStorageProviders.mockRejectedValueOnce(new Error("boom"));
    renderForm(initial());
    fireEvent.click(screen.getByRole("button", { name: m.storageSave }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(m.updateError));
  });

  it("runs a connection test for the S3 provider and shows the result", async () => {
    testAdminStorageProvider.mockResolvedValueOnce({ ok: true });
    renderForm(initial({ activeProvider: "s3" }));

    fireEvent.click(screen.getByRole("button", { name: m.storageTestConnection }));
    expect(await screen.findByText(m.storageTestOk)).toBeInTheDocument();
  });

  it("shows the connection-test error message on failure", async () => {
    testAdminStorageProvider.mockResolvedValueOnce({ ok: false, error: "timed out" });
    renderForm(initial({ activeProvider: "s3" }));

    fireEvent.click(screen.getByRole("button", { name: m.storageTestConnection }));
    await waitFor(() => expect(screen.getByText(m.storageTestFailed)).toBeInTheDocument());
    expect(screen.getByText("timed out")).toBeInTheDocument();
  });

  it("opens the inline secret editor via the 'Set API key' pill and saves via setAdminStorageS3Secret", async () => {
    setAdminStorageS3Secret.mockResolvedValueOnce(
      initial({
        activeProvider: "s3",
        s3: { ...initial().s3, hasSecret: true, secretHint: "••••wxyz" },
      }),
    );
    renderForm(initial({ activeProvider: "s3" }));

    fireEvent.click(screen.getByRole("button", { name: m.credentialSet }));
    await waitFor(() =>
      expect(screen.getByText(`API key · ${m.storageSecretKey}`)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText(m.credentialPlaceholder), {
      target: { value: "s3cr3t" }, // pragma: allowlist secret
    });
    fireEvent.click(screen.getByRole("button", { name: m.credentialSave }));

    await waitFor(
      () => expect(setAdminStorageS3Secret).toHaveBeenCalledWith({ apiKey: "s3cr3t" }), // pragma: allowlist secret
    );
  });

  it("shows the encryption-required note instead of a secret editor when encryption is off", () => {
    renderForm(initial({ activeProvider: "s3", encryptionEnabled: false }));
    expect(screen.getByText(m.storageEncryptionRequired)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.credentialSet })).toBeNull();
  });

  it("shows the masked secret hint and a pencil (not a pill) when a secret is already set", () => {
    renderForm(
      initial({
        activeProvider: "s3",
        s3: { ...initial().s3, hasSecret: true, secretHint: "••••wxyz" },
      }),
    );
    expect(screen.getByText("••••wxyz")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.editCredential })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.credentialSet })).toBeNull();
  });
});
