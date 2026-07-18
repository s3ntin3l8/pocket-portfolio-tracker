import type { ApiClient, AdminStorageResponse } from "@portfolio/api-client";

/** The slice of the API client this form needs (injectable for tests). */
export type AdminStorageClient = Pick<
  ApiClient,
  | "updateAdminStorageProviders"
  | "setAdminStorageS3Secret"
  | "clearAdminStorageS3Secret"
  | "testAdminStorageProvider"
>;

export type Provider = "s3" | "folder";

export interface AdminStorageFormProps {
  initial: AdminStorageResponse;
}
