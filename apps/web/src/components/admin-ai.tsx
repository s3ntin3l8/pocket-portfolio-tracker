"use client";

import type { AdminAiResponse } from "@portfolio/api-client";
import { AdminAiForm } from "@/components/admin-ai-form";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

/** Real-client wrapper: saves AI provider settings, then refreshes server data. */
export function AdminAi({ initial }: { initial: AdminAiResponse }) {
  const api = useApiClient();
  const router = useRouter();
  return <AdminAiForm client={api} initial={initial} onSuccess={() => router.refresh()} />;
}
