import type { ApiClient } from "@portfolio/api-client";

/** The slice of the API client this form needs (injectable for tests). */
export type AdminVisionProvidersClient = Pick<
  ApiClient,
  | "updateAdminVisionProviders"
  | "setAdminVisionProviderCredential"
  | "clearAdminVisionProviderCredential"
>;
