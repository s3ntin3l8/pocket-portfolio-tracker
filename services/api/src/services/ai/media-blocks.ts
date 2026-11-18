/**
 * Provider request blocks for an image or PDF, shared by the vision parsers and the chat
 * adapters so the shapes live in one place. `data` is base64.
 */

/** Anthropic: a PDF is a `document` block, anything else an `image` block. */
export function anthropicMediaBlock(mediaType: string, data: string) {
  const source = { type: "base64" as const, media_type: mediaType, data };
  return mediaType === "application/pdf"
    ? { type: "document" as const, source }
    : { type: "image" as const, source };
}

/** Gemini inline media, snake_case as the vision parser has always sent it. */
export function geminiInlineData(mediaType: string, data: string) {
  return { inline_data: { mime_type: mediaType, data } };
}

/** Gemini inline media, camelCase as the chat adapter's JSON is written. */
export function geminiInlineDataCamel(mediaType: string, data: string) {
  return { inlineData: { mimeType: mediaType, data } };
}

/** OpenAI-compatible `image_url` part carrying a data URL (images only). */
export function openAiImagePart(mediaType: string, data: string) {
  return { type: "image_url" as const, image_url: { url: `data:${mediaType};base64,${data}` } };
}
