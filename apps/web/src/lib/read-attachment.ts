import {
  ASSISTANT_ATTACHMENT_TYPES,
  ASSISTANT_MAX_ATTACHMENT_BYTES,
  type AssistantAttachment,
  type AssistantAttachmentCapability,
} from "@portfolio/api-client";

/** A file picked for the composer: the payload to send plus its size for the chip. */
export interface PendingAttachment extends AssistantAttachment {
  /** Bytes, for display. */
  size: number;
}

export type AttachmentProblem = "type" | "size" | "read";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * The file types worth offering in the picker: images unless the model can't read them, and PDFs
 * always (a provider without native PDF input gets the text layer instead).
 */
export function acceptedAttachmentTypes(
  capability: Pick<AssistantAttachmentCapability, "images"> | undefined,
): string[] {
  const images = capability?.images !== "no";
  return [...(images ? IMAGE_TYPES : []), "application/pdf"];
}

/** Read a picked file as base64, refusing a type or size the API would refuse anyway. */
export async function readAttachment(
  file: File,
  accepted: readonly string[] = ASSISTANT_ATTACHMENT_TYPES,
): Promise<
  { ok: true; attachment: PendingAttachment } | { ok: false; problem: AttachmentProblem }
> {
  if (!accepted.includes(file.type)) return { ok: false, problem: "type" };
  if (file.size > ASSISTANT_MAX_ATTACHMENT_BYTES) return { ok: false, problem: "size" };
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!data) return { ok: false, problem: "read" };
    return {
      ok: true,
      attachment: {
        name: file.name.slice(0, 200) || "file",
        mediaType: file.type as AssistantAttachment["mediaType"],
        data,
        size: file.size,
      },
    };
  } catch {
    return { ok: false, problem: "read" };
  }
}
