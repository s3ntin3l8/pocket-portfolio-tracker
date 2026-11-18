import { extractPdfText } from "../parsers/pdf-text.js";
import type { AttachmentSupport, ChatAttachment, ChatMessage } from "./types.js";

/** Opt-in document attachments for the assistant. Bytes live in memory for one request only. */
export const ATTACHMENT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;
/** Per request (the web resends earlier files with later turns, so this is per conversation). */
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** A PDF read as text is cut here: it is context for one question, not an archive. */
export const MAX_PDF_TEXT_CHARS = 20_000;
export const MAX_ATTACHMENT_NAME_CHARS = 200;
/** Base64 expands 3 bytes to 4 chars; the encoded cap for one file. */
export const MAX_ATTACHMENT_BASE64_CHARS = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4;

export type AttachmentErrorCode = "attachments_disabled" | "attachment_unsupported";

/** What the file's own first bytes say it is, or null. Claimed media types are never trusted. */
export function sniffMediaType(buf: Uint8Array): ChatAttachment["mediaType"] | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

/**
 * True when `a.data` is base64 of at most the size cap whose leading bytes match its claimed
 * type. Checked after the schema so a mislabelled file is refused rather than forwarded.
 */
export function isValidAttachment(a: ChatAttachment): boolean {
  if (a.data.length === 0 || a.data.length > MAX_ATTACHMENT_BASE64_CHARS) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data)) return false;
  const bytes = Buffer.from(a.data, "base64");
  return bytes.length <= MAX_ATTACHMENT_BYTES && sniffMediaType(bytes) === a.mediaType;
}

export function countAttachments(messages: readonly ChatMessage[]): number {
  return messages.reduce((n, m) => n + (m.role === "user" ? (m.attachments?.length ?? 0) : 0), 0);
}

/** A file name safe to put in a prompt or a history marker: no markup, no line breaks. */
export function safeName(name: string): string {
  return (
    // Markup characters and control characters (line breaks included) become spaces.
    [...name]
      .map((c) => (c.charCodeAt(0) < 32 || '<>"'.includes(c) ? " " : c))
      .join("")
      .trim()
      .slice(0, MAX_ATTACHMENT_NAME_CHARS) || "file"
  );
}

/** The `📎 name` lines stored with a turn instead of the file. */
export function attachmentMarkers(attachments: readonly ChatAttachment[] | undefined): string {
  return (attachments ?? []).map((a) => `\n📎 ${safeName(a.name)}`).join("");
}

/** Log fields for a request's attachments: count, types and size, never a name or any content. */
export function attachmentLogFields(messages: readonly ChatMessage[]) {
  const all = messages.flatMap((m) => (m.role === "user" ? (m.attachments ?? []) : []));
  return {
    attachments: all.length,
    types: [...new Set(all.map((a) => a.mediaType))],
    bytes: all.reduce((n, a) => n + Buffer.byteLength(a.data, "base64"), 0),
  };
}

export type PreparedMessages =
  { ok: true; messages: ChatMessage[] } | { ok: false; error: AttachmentErrorCode };

/**
 * Fit the attachments to what the model reads. An image the model can't take is refused; a PDF
 * without native support becomes text inside the message (wrapped as untrusted data), or is
 * refused when it has no text layer. After this, adapters only see blocks they can send.
 */
export async function prepareAttachments(
  messages: ChatMessage[],
  support: AttachmentSupport,
  extract: (data: Buffer) => Promise<string> = extractPdfText,
): Promise<PreparedMessages> {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== "user" || !m.attachments?.length) {
      out.push(m);
      continue;
    }
    const keep: ChatAttachment[] = [];
    let content = m.content;
    for (const a of m.attachments) {
      if (a.mediaType !== "application/pdf") {
        if (support.images === "no") return { ok: false, error: "attachment_unsupported" };
        keep.push(a);
      } else if (support.pdf) {
        keep.push(a);
      } else {
        // An unreadable PDF is the same as one with no text layer.
        const text = await extract(Buffer.from(a.data, "base64"))
          .then((t) => t.trim())
          .catch(() => "");
        if (!text) return { ok: false, error: "attachment_unsupported" };
        // The document is data: keep it from closing its own wrapper.
        const body = text.slice(0, MAX_PDF_TEXT_CHARS).replace(/<\/document/gi, "<\\/document");
        content += `\n\n<document name="${safeName(a.name)}">\n${body}\n</document>`;
      }
    }
    out.push({ role: "user", content, ...(keep.length ? { attachments: keep } : {}) });
  }
  return { ok: true, messages: out };
}
