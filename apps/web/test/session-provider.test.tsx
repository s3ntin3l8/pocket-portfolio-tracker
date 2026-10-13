import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";

const props = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children, ...rest }: { children: React.ReactNode }) => {
    props.current = rest;
    return <>{children}</>;
  },
}));

import { AuthSessionProvider } from "../src/components/session-provider";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("AuthSessionProvider", () => {
  it("refetches every 60s while visible and switches the interval off while hidden", () => {
    setVisibility("visible");
    render(
      <AuthSessionProvider>
        <span />
      </AuthSessionProvider>,
    );
    expect(props.current).toMatchObject({ refetchInterval: 60, refetchOnWindowFocus: true });

    setVisibility("hidden");
    expect(props.current).toMatchObject({ refetchInterval: 0 });

    setVisibility("visible");
    expect(props.current).toMatchObject({ refetchInterval: 60 });
  });
});
