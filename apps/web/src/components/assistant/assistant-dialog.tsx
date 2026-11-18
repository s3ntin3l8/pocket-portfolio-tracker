"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AssistantHeaderActions,
  AssistantPanel,
  type AssistantPanelState,
} from "@/components/assistant/assistant-panel";

export type { AssistantChatApi } from "@/components/assistant/assistant-panel";

/**
 * The phone container: a full-screen page whose header row carries History / New chat next to
 * the back arrow. (At `md:` and up the host docks the panel instead; this is a centered card
 * only for the short stretch the dock is not available.)
 */
export function AssistantDialog({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AssistantPanelState;
}) {
  const t = useTranslations("Assistant");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        mobileHeader={{
          title: t("title"),
          actions: <AssistantHeaderActions state={state} />,
        }}
        // The panel owns its scroll region and pinned composer.
        bodyClassName="flex min-h-0 flex-1 flex-col"
        // The disclosure is visible in the panel itself; a hidden copy would only duplicate it.
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          // Desktop-width card: start typing right away. On touch layouts leave focus alone,
          // focusing the field would raise the keyboard over the suggestions.
          if (window.matchMedia?.("(min-width: 768px)").matches) {
            e.preventDefault();
            state.inputRef.current?.focus();
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <AssistantPanel state={state} />
      </DialogContent>
    </Dialog>
  );
}
