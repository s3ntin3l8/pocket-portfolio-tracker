import type { ApiClient } from "@portfolio/api-client";

/** The slice of the API client the AI providers page needs (injectable for tests). */
export type AdminAiClient = Pick<
  ApiClient,
  | "updateAdminAiTask"
  | "updateAdminAiProvider"
  | "setAdminAiCredential"
  | "clearAdminAiCredential"
  | "listAdminAiModels"
>;

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
