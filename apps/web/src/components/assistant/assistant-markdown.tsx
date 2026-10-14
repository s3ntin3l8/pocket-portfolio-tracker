"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Only links that go somewhere safe are made clickable. */
const SAFE_HREF = /^(https?:\/\/|\/(?!\/))/i;

/**
 * The assistant's answers are model output, i.e. untrusted: raw HTML is never rendered, and
 * images are dropped entirely — a markdown image would make the browser fetch an arbitrary
 * URL the moment the answer appears, which is a data-exfiltration channel for a prompt-injected
 * model. Links open in a new tab with no referrer and only for http(s)/relative targets.
 */
const components: Components = {
  img: () => null,
  a: ({ href, children }) =>
    href && SAFE_HREF.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        className="font-semibold text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  h1: ({ children }) => <p className="mb-1 mt-3 text-base font-extrabold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 text-sm font-extrabold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-2 text-sm font-bold first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-background px-1 py-0.5 text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-background p-3 text-xs last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-text-2 last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 text-left font-bold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border/60 px-2 py-1">{children}</td>,
};

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
      {text}
    </ReactMarkdown>
  );
}
