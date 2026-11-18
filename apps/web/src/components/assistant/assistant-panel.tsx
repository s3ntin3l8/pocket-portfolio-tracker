"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  CircleAlert,
  History,
  Maximize2,
  Minimize2,
  Paperclip,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  AssistantAttachment,
  AssistantConversationSummary,
  AssistantStatus,
} from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AssistantMarkdown } from "@/components/assistant/assistant-markdown";
import { MAX_MESSAGE_CHARS, displayText, type ChatTurn, type ToolStep } from "@/lib/assistant-chat";
import type { ComposerAttachments } from "@/lib/use-composer-attachments";
import { Link } from "@/i18n/navigation";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";

export interface AssistantChatApi {
  turns: ChatTurn[];
  streaming: boolean;
  /** Starts an answer; `files` are the opt-in documents attached to this turn. */
  send: (text: string, files?: AssistantAttachment[]) => boolean;
  stop: () => void;
  reset: () => void;
  /** The stored conversation is full: new messages are not being saved. */
  conversationFull?: boolean;
  /** Stored conversations; null when the client can't list them. */
  history?: {
    list: () => Promise<AssistantConversationSummary[]>;
    open: (id: string) => Promise<boolean>;
    remove: (id: string) => Promise<boolean>;
  } | null;
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
        <div className="max-w-[85%] space-y-1 rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap break-words">{turn.content}</p>
          {turn.attachments && turn.attachments.length > 0 && (
            <ul aria-label={t("attachedFiles")} className="space-y-0.5 text-xs">
              {turn.attachments.map((a, i) => (
                <li key={`${a.name}-${i}`} className="flex items-center gap-1 break-all">
                  <Paperclip className="size-3 shrink-0" aria-hidden />
                  {a.name}
                </li>
              ))}
            </ul>
          )}
          {turn.attachments?.some((a) => a.reattach) && (
            <p className="text-xs">{t("attachAgain")}</p>
          )}
        </div>
      </div>
    );
  }
  const text = displayText(turn);
  const waiting = turn.pending && !text && turn.steps.length === 0 && !turn.progress;
  const stoppedEmpty = turn.stopped && !text && !turn.error;
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
        {stoppedEmpty && <p className="text-xs text-text-2">{t("stopped")}</p>}
        {text && <AssistantMarkdown text={text} />}
        {turn.pending && turn.progress && !turn.streaming && (
          // Model output: plain text only, never Markdown.
          <p className="flex items-start gap-2 text-text-2">
            <Spinner className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-3 break-words">{turn.progress}</span>
          </p>
        )}
        {turn.error && (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {t.has(`errors.${turn.error}`) ? t(`errors.${turn.error}`) : t("errors.generic")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Saved conversations (opted-in users): reopen one, or delete it. */
function HistoryPanel({
  history,
  enabled,
  onEnable,
  onOpened,
}: {
  history: NonNullable<AssistantChatApi["history"]>;
  /** Saving is on; when it is off the panel offers to turn it on instead of listing. */
  enabled: boolean;
  onEnable?: () => Promise<boolean>;
  onOpened: () => void;
}) {
  const t = useTranslations("Assistant");
  const locale = useLocale();
  const [items, setItems] = useState<AssistantConversationSummary[] | null>(null);
  const [error, setError] = useState<"load" | "open" | "delete" | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableFailed, setEnableFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    history
      .list()
      .then((list) => alive && setItems(list))
      .catch(() => alive && setError("load"));
    return () => {
      alive = false;
    };
  }, [history, enabled]);

  if (!enabled) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-2">{t("historyOff")}</p>
        {onEnable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enabling}
            onClick={async () => {
              setEnabling(true);
              setEnableFailed(false);
              const ok = await onEnable();
              setEnabling(false);
              if (!ok) setEnableFailed(true);
            }}
          >
            {enabling && <Spinner className="size-3.5" />}
            {t("historyEnable")}
          </Button>
        )}
        {enableFailed && (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {t("historyEnableError")}
          </p>
        )}
        <p className="text-micro text-text-2">{t("historyNote")}</p>
      </div>
    );
  }
  if (error === "load") return <p className="text-sm text-destructive">{t("historyLoadError")}</p>;
  if (!items) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-2">
        <Spinner className="size-3.5" />
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {(error === "open" || error === "delete") && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {error === "open" ? t("historyOpenError") : t("historyDeleteError")}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-text-2">{t("historyEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-muted">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-1 pr-1">
              <button
                type="button"
                aria-label={t("historyOpen", { title: c.title })}
                className="min-w-0 flex-1 px-3 py-2.5 text-left hover:bg-accent/50"
                onClick={async () => {
                  setError(null);
                  if (await history.open(c.id)) onOpened();
                  else setError("open");
                }}
              >
                <span className="block truncate text-sm font-semibold">{c.title}</span>
                <span className="block text-micro text-text-2">
                  {formatDateTime(c.updatedAt, locale)}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("historyDelete", { title: c.title })}
                onClick={async () => {
                  setError(null);
                  if (await history.remove(c.id)) {
                    setItems((list) => list?.filter((x) => x.id !== c.id) ?? null);
                  } else {
                    setError("delete");
                  }
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-micro text-text-2">{t("historyNote")}</p>
    </div>
  );
}

/** View state shared by both containers, owned by the host so a resize (dock <-> dialog) keeps it. */
export interface AssistantPanelState {
  chat: AssistantChatApi;
  status: AssistantStatus | null;
  enableHistory?: () => Promise<boolean>;
  /** Saving was turned on from the panel this session (the status is only fetched once). */
  savingEnabled: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Files waiting in the composer. Absent = the panel has no attachment control. */
  attachments?: ComposerAttachments;
}

/**
 * History / New chat (and, in the dock, expand and close) as one row of identically sized
 * controls, so every icon shares a centre line. Rendered in the mobile header or the dock header.
 */
export function AssistantHeaderActions({
  state,
  onClose,
  expand,
}: {
  state: AssistantPanelState;
  /** Dock only: the mobile header closes with its back arrow. */
  onClose?: () => void;
  /** Dock only, and only where a wide size fits. */
  expand?: { wide: boolean; onToggle: () => void };
}) {
  const t = useTranslations("Assistant");
  const { chat, showHistory, setShowHistory } = state;
  return (
    <div className="flex items-center gap-1">
      {chat.history && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9"
          aria-pressed={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          <History />
          {showHistory ? t("historyBack") : t("history")}
        </Button>
      )}
      {chat.turns.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => {
            setShowHistory(false);
            chat.reset();
          }}
        >
          <RotateCcw />
          {t("newChat")}
        </Button>
      )}
      {expand && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 max-2xl:hidden"
          aria-pressed={expand.wide}
          aria-label={expand.wide ? t("collapse") : t("expand")}
          onClick={expand.onToggle}
        >
          {expand.wide ? <Minimize2 /> : <Maximize2 />}
        </Button>
      )}
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/**
 * The conversation and its composer, container-agnostic: a flex column that fills whatever
 * bounded-height parent it is given. Content sits against the composer (chat-app convention), so
 * the empty state and short chats are never stranded mid-screen.
 */
export function AssistantPanel({ state }: { state: AssistantPanelState }) {
  const t = useTranslations("Assistant");
  const {
    chat,
    status,
    enableHistory,
    savingEnabled,
    draft,
    setDraft,
    showHistory,
    setShowHistory,
    inputRef,
  } = state;
  const historyOn = Boolean(status?.saveHistory) || savingEnabled;
  const att = state.attachments;
  const capability = status?.attachments;
  const attachmentsOn = capability?.enabled === true && att !== undefined;
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view as the answer streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.turns]);

  const submit = () => {
    if (!draft.trim() || chat.streaming) return;
    // The wire shape only: the chip's size is for display.
    const files = attachmentsOn
      ? att.files.map(({ name, mediaType, data }) => ({ name, mediaType, data }))
      : undefined;
    chat.send(draft, files);
    setDraft("");
    att?.clear();
  };

  const provider = status?.label ?? "";
  const disclosure = status?.local
    ? t(capability?.enabled ? "disclosureLocalAttachments" : "disclosureLocal")
    : t(capability?.enabled ? "disclosureCloudAttachments" : "disclosureCloud", { provider });
  // Off, but the model could read a document: point at the setting instead of a dead end.
  const offerAttachments =
    capability !== undefined && !capability.enabled && capability.images !== "no";

  // A missing suggestion key must never render the key path: fall back to the id.
  const suggestionLabel = (key: string) =>
    t.has(`suggestions.${key}`) ? t(`suggestions.${key}`) : key;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          role="log"
          aria-live="polite"
          aria-label={t("conversation")}
          className="mt-auto space-y-3 px-4 py-4 md:px-5"
        >
          {showHistory && chat.history ? (
            <HistoryPanel
              history={chat.history}
              enabled={historyOn}
              onEnable={enableHistory}
              onOpened={() => setShowHistory(false)}
            />
          ) : chat.turns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-text-2">{disclosure}</p>
              <p className="text-sm text-text-2">{t("emptyHint")}</p>
              {offerAttachments && (
                <p className="text-xs text-text-2">
                  {t.rich("attachHint", {
                    link: (chunks) => (
                      <Link href="/settings/investing" className="font-semibold underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => chat.send(suggestionLabel(key))}
                  >
                    {suggestionLabel(key)}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            chat.turns.map((turn) => <Turn key={turn.id} turn={turn} />)
          )}
          <div ref={endRef} />
        </div>
      </div>
      {chat.conversationFull && !showHistory && (
        <p role="status" className="px-4 pb-2 text-xs text-text-2 md:px-5">
          {t("historyFull")}
        </p>
      )}
      <div className="shrink-0 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-5">
        {attachmentsOn && att.files.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {att.warningOpen && (
              <p role="status" className="text-xs text-text-2">
                {t(status?.local ? "attachWarningLocal" : "attachWarning", { provider })}
              </p>
            )}
            <ul aria-label={t("attachedFiles")} className="flex flex-wrap gap-1.5">
              {att.files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs"
                >
                  <Paperclip className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-text-2">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => att.remove(i)}
                    aria-label={t("removeAttachment", { name: f.name })}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {attachmentsOn && att.error && (
          <p role="alert" className="mb-2 text-xs font-semibold text-destructive">
            {t.has(`attachErrors.${att.error}`)
              ? t(`attachErrors.${att.error}`)
              : t("attachErrors.read")}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex w-full items-end gap-2"
        >
          {attachmentsOn && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept={att.accept.join(",")}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  // Reset so choosing the same file again fires a change.
                  e.target.value = "";
                  if (picked.length > 0) void att.add(picked);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("attach")}
                disabled={att.room <= 0 || chat.streaming}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip />
              </Button>
            </>
          )}
          <textarea
            ref={inputRef}
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
        <p className="mt-2 text-micro text-text-2">{t("disclaimer")}</p>
      </div>
    </div>
  );
}
