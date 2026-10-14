"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CircleAlert, RotateCcw, Send, Square } from "lucide-react";
import type { AssistantStatus } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { AssistantMarkdown } from "@/components/assistant/assistant-markdown";
import { MAX_MESSAGE_CHARS, type ChatTurn, type ToolStep } from "@/lib/assistant-chat";
import { cn } from "@/lib/utils";

export interface AssistantChatApi {
  turns: ChatTurn[];
  streaming: boolean;
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
}

const SUGGESTIONS = ["overview", "gains", "allocation"] as const;

function StepChip({ step }: { step: ToolStep }) {
  const t = useTranslations("Assistant");
  const label = t.has(`tools.${step.name}`) ? t(`tools.${step.name}`) : step.name;
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-micro font-semibold",
        step.status === "failed" ? "text-destructive" : "text-text-2",
      )}
    >
      {step.status === "running" ? (
        <Spinner className="size-3" />
      ) : step.status === "failed" ? (
        <CircleAlert className="size-3" aria-hidden />
      ) : (
        <Check className="size-3" aria-hidden />
      )}
      {label}
    </li>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const t = useTranslations("Assistant");
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          {turn.content}
        </p>
      </div>
    );
  }
  const waiting = turn.pending && !turn.content && turn.steps.length === 0;
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] min-w-0 space-y-2 rounded-xl bg-muted px-3 py-2 text-sm">
        {turn.steps.length > 0 && (
          <ul aria-label={t("steps")} className="flex flex-wrap gap-1">
            {turn.steps.map((s) => (
              <StepChip key={s.id} step={s} />
            ))}
          </ul>
        )}
        {waiting && (
          <p className="flex items-center gap-2 text-text-2">
            <Spinner className="size-3.5" />
            {t("thinking")}
          </p>
        )}
        {turn.content && <AssistantMarkdown text={turn.content} />}
        {turn.error && (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {t(`errors.${turn.error}`)}
          </p>
        )}
      </div>
    </div>
  );
}

/** The chat panel. Presentational: state lives in the host so a conversation survives closing. */
export function AssistantDialog({
  open,
  onOpenChange,
  chat,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chat: AssistantChatApi;
  status: AssistantStatus | null;
}) {
  const t = useTranslations("Assistant");
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view as the answer streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.turns]);

  const submit = () => {
    if (!draft.trim() || chat.streaming) return;
    chat.send(draft);
    setDraft("");
  };

  const disclosure = status?.local
    ? t("disclosureLocal")
    : t("disclosureCloud", { provider: status?.label ?? "" });

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-border bg-card px-4 py-3"
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={MAX_MESSAGE_CHARS}
        aria-label={t("inputLabel")}
        placeholder={t("placeholder")}
        className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
      />
      {chat.streaming ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={chat.stop}
          aria-label={t("stop")}
        >
          <Square />
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={!draft.trim()} aria-label={t("send")}>
          <Send />
        </Button>
      )}
    </form>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" mobileHeader={{ title: t("title") }} footer={composer}>
        <DialogHeader className="px-4 pt-4 md:px-6 md:pt-6">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle>{t("title")}</DialogTitle>
            {chat.turns.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={chat.reset}>
                <RotateCcw />
                {t("newChat")}
              </Button>
            )}
          </div>
          <DialogDescription>{disclosure}</DialogDescription>
        </DialogHeader>
        <div
          role="log"
          aria-live="polite"
          aria-label={t("conversation")}
          className="space-y-3 px-4 py-4 md:px-6"
        >
          {chat.turns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-text-2">{t("emptyHint")}</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => chat.send(t(`suggestions.${key}`))}
                  >
                    {t(`suggestions.${key}`)}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            chat.turns.map((turn) => <Turn key={turn.id} turn={turn} />)
          )}
          <div ref={endRef} />
        </div>
        <p className="px-4 pb-3 text-micro text-text-2 md:px-6">{t("disclaimer")}</p>
      </DialogContent>
    </Dialog>
  );
}
