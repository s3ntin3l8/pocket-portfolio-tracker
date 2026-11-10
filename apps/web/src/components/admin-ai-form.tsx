"use client";

import { useCallback, useState } from "react";
import type { AdminAiResponse } from "@portfolio/api-client";
import { ConnectionsCard } from "@/components/admin-ai/connections-card";
import { TaskCard } from "@/components/admin-ai/task-card";
import type { AdminAiClient } from "@/components/admin-ai/types";

/**
 * One page for every AI provider setting: the shared connections (keys/URLs) on top, then the
 * provider + model for each task. Each save returns the whole view, which replaces ours.
 */
export function AdminAiForm({
  client,
  initial,
  onSuccess,
}: {
  client: AdminAiClient;
  initial: AdminAiResponse;
  onSuccess?: () => void;
}) {
  const [view, setView] = useState(initial);
  const apply = useCallback(
    (res: AdminAiResponse) => {
      setView(res);
      onSuccess?.();
    },
    [onSuccess],
  );

  return (
    <div className="space-y-6">
      <ConnectionsCard
        connections={view.connections}
        encryptionEnabled={view.encryptionEnabled}
        client={client}
        onChange={apply}
      />
      {view.tasks.map((setting) => (
        <TaskCard
          key={setting.task}
          task={setting.task}
          setting={setting}
          connections={view.connections}
          client={client}
          onSaved={apply}
        />
      ))}
    </div>
  );
}
