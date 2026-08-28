"use client";

import { ChangePasswordForm } from "@/components/change-password-form";
import { useApiClient } from "@/lib/api";

/** Real-client wrapper: injects the live api-client into ChangePasswordForm. */
export function ChangePassword() {
  const api = useApiClient();
  return <ChangePasswordForm client={api} />;
}
