import type { z } from "zod";

/**
 * A transport-neutral tool. The MCP route registers `inputSchema` as-is (zod 4); the chat
 * loop converts it with `toJsonSchema`. `handler` already returns redacted, LLM-sized data.
 */
export interface AiTool<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  /**
   * False for a tool that writes (only ever *draft* records the user confirms). Absent = read
   * only. Write tools are offered only to write-scoped credentials.
   */
  readOnly?: boolean;
  handler: (input: z.infer<S>) => Promise<unknown>;
}
