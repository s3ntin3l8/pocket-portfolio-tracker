import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const refresh = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));

import { ScopeSync } from "../src/components/scope-sync";
import { resolveScope, scopeToCookieValue } from "../src/lib/portfolio-selection";

/** What the (app) layout passes: the scope as the server resolved it (header > cookie). */
const serverScopeFor = (param: string | null, cookie?: string) =>
  scopeToCookieValue(resolveScope({ param, cookie }));

function setUrl(scope: string | null) {
  mockSearchParams = new URLSearchParams(scope ? `scope=${scope}` : "");
}

describe("ScopeSync", () => {
  beforeEach(() => {
    refresh.mockClear();
    document.cookie = "pf=; path=/; max-age=0";
    setUrl(null);
  });

  it("does not refresh when the server scope already equals the URL scope", () => {
    for (const param of ["p:abc", "h:xyz", "all"]) {
      setUrl(param);
      render(<ScopeSync serverScope={serverScopeFor(param)} />);
    }
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh on a scope-less URL when the cookie matches", () => {
    document.cookie = "pf=abc; path=/";
    render(<ScopeSync serverScope={serverScopeFor(null, "abc")} />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once when the URL scope differs from the one the layout rendered for", () => {
    setUrl("p:b");
    const { rerender } = render(<ScopeSync serverScope="a" />);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<ScopeSync serverScope="a" />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on each history step across scopes (back lands on a stale layout)", () => {
    setUrl("p:b");
    const { rerender } = render(<ScopeSync serverScope="a" />);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The refresh lands: layout now rendered for b.
    rerender(<ScopeSync serverScope="b" />);
    // Browser back to scope a; layout is still the one for b.
    setUrl("p:a");
    rerender(<ScopeSync serverScope="b" />);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("falls back to the cookie when back lands on a scope-less URL", () => {
    document.cookie = "pf=b; path=/";
    setUrl(null);
    render(<ScopeSync serverScope="a" />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
