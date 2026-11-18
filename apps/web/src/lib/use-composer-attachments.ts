"use client";

import { useCallback, useRef, useState } from "react";
import {
  ASSISTANT_MAX_ATTACHMENTS,
  type AssistantAttachment,
  type AssistantAttachmentCapability,
} from "@portfolio/api-client";
import {
  acceptedAttachmentTypes,
  readAttachment,
  type PendingAttachment,
} from "@/lib/read-attachment";

export type ComposerAttachmentError = "type" | "size" | "read" | "count";

/**
 * The files waiting in the composer (opt-in attachments). Held in memory only: a reload, New chat
 * or sending the message empties them. `sentCount` is what the conversation already carries, since
 * the API allows {@link ASSISTANT_MAX_ATTACHMENTS} across the whole conversation. The first attach
 * of a session opens a one-line privacy warning (shown once; it closes when the message is sent).
 */
export function useComposerAttachments(
  capability: AssistantAttachmentCapability | undefined,
  sentCount: number,
) {
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<ComposerAttachmentError | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const warned = useRef(false);
  const room = Math.max(0, ASSISTANT_MAX_ATTACHMENTS - sentCount - files.length);

  const add = useCallback(
    async (picked: File[]) => {
      setError(null);
      const accepted = acceptedAttachmentTypes(capability);
      let free = room;
      const next: PendingAttachment[] = [];
      for (const file of picked) {
        if (free <= 0) {
          setError("count");
          break;
        }
        const read = await readAttachment(file, accepted);
        if (!read.ok) {
          setError(read.problem);
          continue;
        }
        next.push(read.attachment);
        free -= 1;
      }
      if (next.length === 0) return;
      setFiles((current) => [...current, ...next]);
      if (!warned.current) {
        warned.current = true;
        setWarningOpen(true);
      }
    },
    [capability, room],
  );

  const remove = useCallback((index: number) => {
    setError(null);
    setFiles((current) => {
      const next = current.filter((_, i) => i !== index);
      // The warning belongs to the first attach: once the composer is empty it is spent.
      if (next.length === 0) setWarningOpen(false);
      return next;
    });
  }, []);

  /** Take back files the API refused, so they can be retried or removed. */
  const restore = useCallback((back: AssistantAttachment[]) => {
    setFiles(back.map((f) => ({ ...f, size: Math.floor((f.data.length * 3) / 4) })));
    setError(null);
  }, []);

  /** Empty the composer (after a send, or on New chat). Keeps "already warned". */
  const clear = useCallback(() => {
    setFiles([]);
    setError(null);
    setWarningOpen(false);
  }, []);

  return {
    files,
    error,
    warningOpen,
    room,
    accept: acceptedAttachmentTypes(capability),
    add,
    remove,
    restore,
    clear,
  };
}

export type ComposerAttachments = ReturnType<typeof useComposerAttachments>;
