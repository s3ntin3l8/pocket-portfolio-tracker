import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "../src/components/ui/dialog";
import { useSheetFooter } from "../src/components/ui/sheet";
import {
  FullScreenOverlayProvider,
  useAnyFullScreenOverlayOpen,
} from "../src/components/full-screen-overlay";

afterEach(cleanup);

// JSDOM doesn't evaluate media queries, so "full-screen on mobile, centered on desktop"
// is asserted via the responsive Tailwind classes themselves (max-md:/md:), matching how
// this codebase already tests other CSS-only responsive splits (e.g. transactions-table's
// dual-rendered mobile/desktop search inputs).
describe("DialogContent", () => {
  it("defaults to full-screen-on-mobile geometry at the sm size", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="content">
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const el = screen.getByTestId("content");
    expect(el.className).toContain("inset-0");
    expect(el.className).toContain("rounded-none");
    expect(el.className).toContain("md:rounded-[22px]");
    expect(el.className).toContain("md:max-w-[480px]");
  });

  it.each([
    ["sm", "md:max-w-[480px]"],
    ["md", "md:max-w-[600px]"],
    ["lg", "md:max-w-[880px]"],
    ["xl", "md:max-w-[1080px]"],
  ] as const)("size=%s applies %s", (size, expectedClass) => {
    render(
      <Dialog open>
        <DialogContent data-testid="content" size={size}>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId("content").className).toContain(expectedClass);
  });

  it("fullScreenOnMobile=false stays centered at every width (confirm dialogs)", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="content" fullScreenOnMobile={false}>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const el = screen.getByTestId("content");
    expect(el.className).not.toContain("max-md:");
    expect(el.className).not.toContain("inset-0");
    expect(el.className).toContain("rounded-xl");
    expect(el.className).toContain("max-w-[480px]");
  });

  it("mobileHeader renders a back button and heading without a duplicate DialogTitle id", () => {
    render(
      <Dialog open>
        <DialogContent mobileHeader={{ title: "Create portfolio" }}>
          <DialogTitle className="sr-only">Create portfolio</DialogTitle>
          <p>Body</p>
        </DialogContent>
      </Dialog>,
    );
    // Two headings legitimately exist with the same text: the visible mobile h1
    // (mobileHeader) and the sr-only accessible DialogTitle the caller renders itself.
    const headings = screen.getAllByRole("heading", { name: "Create portfolio" });
    expect(headings).toHaveLength(2);
    expect(headings.some((h) => h.tagName === "H1")).toBe(true);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    // Exactly one element carries the Dialog's title id — Radix derives it from shared
    // context, so a second DialogTitle-rendered id here would collide with the one
    // above and produce a duplicate id in the DOM.
    const titled = screen.getByText("Create portfolio", { selector: "h1" });
    const srOnlyTitle = screen.getByText("Create portfolio", { selector: ".sr-only" });
    expect(titled.id).not.toBe(srOnlyTitle.id);
  });

  it("hides the floating close button on mobile when mobileHeader is present", () => {
    render(
      <Dialog open>
        <DialogContent mobileHeader={{ title: "T" }}>
          <DialogTitle className="sr-only">T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const closeButtons = screen.getAllByRole("button", { name: /close|back/i });
    const floatingClose = closeButtons.find(
      (b) => b.querySelector(".sr-only")?.textContent === "Close",
    );
    expect(floatingClose?.className).toContain("max-md:hidden");
  });

  it("provides SheetFooterContext to children when a footer is given", () => {
    function Probe() {
      const footerEl = useSheetFooter();
      return <span data-testid="probe">{footerEl ? "has-footer" : "no-footer"}</span>;
    }
    render(
      <Dialog open>
        <DialogContent footer={<span>Cancel</span>}>
          <DialogTitle>T</DialogTitle>
          <Probe />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("has-footer");
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("omits SheetFooterContext when no footer is given", () => {
    function Probe() {
      const footerEl = useSheetFooter();
      return <span data-testid="probe">{footerEl ? "has-footer" : "no-footer"}</span>;
    }
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
          <Probe />
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("no-footer");
  });

  // Regression test: found by review — `condition && <content/>` (a common React
  // idiom for a conditional footer, e.g. ca-sheet-content.tsx's `ca && (<>...</>)`)
  // evaluates to `null`, not `false`, when `condition` is falsy. `hasFooter` used to
  // only special-case `undefined`/`false`, so a `null` footer rendered an empty footer
  // bar (border, padding, safe-area inset) with nothing in it instead of omitting it.
  it("omits the footer bar when footer is null, same as undefined", () => {
    render(
      <Dialog open>
        <DialogContent footer={null}>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
  });
});

describe("full-screen overlay registration", () => {
  function NavProbe() {
    const open = useAnyFullScreenOverlayOpen();
    return <span data-testid="nav-probe">{open ? "hidden" : "visible"}</span>;
  }

  it("is false outside a provider (no BottomNav to hide)", () => {
    render(<NavProbe />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("visible");
  });

  it("reports open while a fullScreenOnMobile DialogContent is mounted, and closes on unmount", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <FullScreenOverlayProvider>
          <NavProbe />
          <Dialog open={open}>
            {open && (
              <DialogContent>
                <DialogTitle>T</DialogTitle>
              </DialogContent>
            )}
          </Dialog>
        </FullScreenOverlayProvider>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("visible");

    rerender(<Harness open={true} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("hidden");

    rerender(<Harness open={false} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("visible");
  });

  it("does not register a fullScreenOnMobile={false} dialog (confirms never hide the nav)", () => {
    render(
      <FullScreenOverlayProvider>
        <NavProbe />
        <Dialog open>
          <DialogContent fullScreenOnMobile={false}>
            <DialogTitle>T</DialogTitle>
          </DialogContent>
        </Dialog>
      </FullScreenOverlayProvider>,
    );
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("visible");
  });

  it("stays registered across unrelated parent re-renders (no thrashing)", () => {
    function Harness({ tick }: { tick: number }) {
      return (
        <FullScreenOverlayProvider>
          <NavProbe />
          <span data-testid="tick">{tick}</span>
          <Dialog open>
            <DialogContent>
              <DialogTitle>T</DialogTitle>
            </DialogContent>
          </Dialog>
        </FullScreenOverlayProvider>
      );
    }
    const { rerender } = render(<Harness tick={0} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("hidden");
    for (let tick = 1; tick <= 3; tick++) {
      rerender(<Harness tick={tick} />);
      expect(screen.getByTestId("tick")).toHaveTextContent(String(tick));
      expect(screen.getByTestId("nav-probe")).toHaveTextContent("hidden");
    }
  });
});
