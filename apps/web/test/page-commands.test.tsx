import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PageCommandsProvider,
  usePageCommands,
  useRegisterPageCommands,
  type PageCommandItem,
} from "../src/components/page-commands";

function Registrar({
  id = "g",
  items,
  heading = "Heading",
}: {
  id?: string;
  items: PageCommandItem[];
  heading?: string;
}) {
  useRegisterPageCommands({ id, heading, items });
  return null;
}

function Reader() {
  const groups = usePageCommands();
  return (
    <ul>
      {groups.map((g) => (
        <li key={g.id} data-testid={g.id}>
          {g.heading}:{g.items.map((i) => i.label).join(",")}
        </li>
      ))}
    </ul>
  );
}

const item = (id: string, run: PageCommandItem["run"] = () => {}): PageCommandItem => ({
  id,
  label: `Item ${id}`,
  run,
});

describe("page commands registry", () => {
  it("is an empty list outside the provider", () => {
    render(<Reader />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("registers on mount and unregisters on unmount", () => {
    const { rerender } = render(
      <PageCommandsProvider>
        <Registrar items={[item("a")]} />
        <Reader />
      </PageCommandsProvider>,
    );
    expect(screen.getByTestId("g")).toHaveTextContent("Heading:Item a");
    rerender(
      <PageCommandsProvider>
        <Reader />
      </PageCommandsProvider>,
    );
    expect(screen.queryByTestId("g")).not.toBeInTheDocument();
  });

  it("does not re-register for equal-but-new items, yet run sees the latest closure", () => {
    const first = vi.fn();
    const second = vi.fn();
    const sink: { item?: PageCommandItem } = {};
    function Capture() {
      const item = usePageCommands()[0]?.items[0];
      useEffect(() => {
        sink.item = item;
      });
      return null;
    }
    const tree = (run: PageCommandItem["run"]) => (
      <PageCommandsProvider>
        <Registrar items={[item("a", run)]} />
        <Capture />
        <Reader />
      </PageCommandsProvider>
    );
    const { rerender } = render(tree(first));
    const registered = sink.item;
    rerender(tree(second));
    // Same stable registered item object: no unregister/register round trip happened.
    expect(sink.item).toBe(registered);
    sink.item!.run({ navigate: vi.fn(), close: vi.fn() });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("re-registers when the item set changes", () => {
    const tree = (ids: string[]) => (
      <PageCommandsProvider>
        <Registrar items={ids.map((i) => item(i))} />
        <Reader />
      </PageCommandsProvider>
    );
    const { rerender } = render(tree(["a"]));
    rerender(tree(["a", "b"]));
    expect(screen.getByTestId("g")).toHaveTextContent("Item a,Item b");
  });

  it("a duplicate id: the later registration wins and the earlier unmount keeps it", () => {
    const tree = (withFirst: boolean) => (
      <PageCommandsProvider>
        {withFirst && <Registrar id="dup" heading="First" items={[item("a")]} />}
        <Registrar id="dup" heading="Second" items={[item("b")]} />
        <Reader />
      </PageCommandsProvider>
    );
    const { rerender } = render(tree(true));
    expect(screen.getByTestId("dup")).toHaveTextContent("Second:Item b");
    rerender(tree(false));
    expect(screen.getByTestId("dup")).toHaveTextContent("Second:Item b");
  });
});
