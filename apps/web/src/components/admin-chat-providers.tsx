"use client";

import type { AdminChatProvidersResponse } from "@portfolio/api-client";
import { AdminChatProvidersForm } from "@/components/admin-chat-providers-form";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

/** Real-client wrapper: saves the assistant provider settings, then refreshes server data. */
export function AdminChatProviders({ initial }: { initial: AdminChatProvidersResponse }) {
  const api = useApiClient();
  const router = useRouter();
  return (
    <AdminChatProvidersForm client={api} initial={initial} onSuccess={() => router.refresh()} />
  );
}
