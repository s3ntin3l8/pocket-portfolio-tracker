"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/components/api-tokens-manager";

const URL_PLACEHOLDER = "<your-pocket-api-url>";
const TOKEN_PLACEHOLDER = "<token>";
const ENDPOINT = `${URL_PLACEHOLDER}/mcp`;
const HEADER = `Authorization: Bearer ${TOKEN_PLACEHOLDER}`;

const CLAUDE_CODE = `claude mcp add --transport http pocket ${ENDPOINT} --header "${HEADER}"`;
const CLAUDE_DESKTOP = JSON.stringify(
  {
    mcpServers: {
      pocket: { command: "npx", args: ["-y", "mcp-remote", ENDPOINT, "--header", HEADER] },
    },
  },
  null,
  2,
);

function Snippet({ label, text }: { label: string; text: string }) {
  const t = useTranslations("Settings");
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-bold text-text-2">{label}</p>
        <button
          type="button"
          onClick={async () => {
            if (await copyToClipboard(text)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-muted"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t("tokensCopied") : t("tokensCopy")}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/**
 * "Connect an AI assistant": copy-paste setup for the read-only MCP endpoint. The token is
 * created in the access-tokens card above (read-only is enough); the API address is the
 * public one, which the web app can't know, so it stays a placeholder.
 */
export function McpConnectCard() {
  const t = useTranslations("Settings");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("mcpHint")}</p>
      <Snippet label={t("mcpClaudeCode")} text={CLAUDE_CODE} />
      <Snippet label={t("mcpClaudeDesktop")} text={CLAUDE_DESKTOP} />
      <p className="text-xs text-muted-foreground">{t("mcpPlaceholders")}</p>
    </div>
  );
}
