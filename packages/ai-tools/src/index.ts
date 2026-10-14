import { z } from "zod";
import type { AiTool } from "./types.js";

export { createTools, isToolError, type CreateToolsOptions } from "./tools.js";
export { stripSensitive, isSensitiveKey, scrubText } from "./redact.js";
export { GLOSSARY } from "./glossary.js";
export type { AiTool } from "./types.js";

/** JSON Schema for a tool's input — what the chat loop hands to a provider's tool API. */
export function toJsonSchema(tool: AiTool): Record<string, unknown> {
  return z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
}
