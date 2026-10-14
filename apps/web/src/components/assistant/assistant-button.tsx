"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/components/assistant/assistant-provider";

/** Top-bar entry to the assistant; renders nothing unless chat is configured. */
export function AssistantButton({ className }: { className?: string }) {
  const t = useTranslations("Assistant");
  const { available, open } = useAssistant();
  if (!available) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("open")}
      onClick={() => open()}
      className={className}
    >
      <Sparkles />
    </Button>
  );
}
