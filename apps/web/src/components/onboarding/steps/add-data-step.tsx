import { Icon, ICONS } from "../icon";

export type AddDataCardKey = "connect" | "import" | "manual" | "skip";

const CARD_ICONS: Record<AddDataCardKey, string> = {
  connect: ICONS.addData.connect,
  import: ICONS.addData.import,
  manual: ICONS.addData.manual,
  skip: ICONS.addData.skip,
};

export interface AddDataCopy {
  connectTitle: string;
  connectDesc: string;
  importTitle: string;
  importDesc: string;
  manualTitle: string;
  manualDesc: string;
  skipTitle: string;
  skipDesc: string;
}

/** Step 4 — Add data: 4 cards, each routing to a real sub-flow (wired by the parent
 *  flow — connect/import/manual/skip are genuinely distinct destinations here, unlike
 *  the design's stub which jumps every card straight to Done). */
export function AddDataStep({
  copy,
  onSelect,
}: {
  copy: AddDataCopy;
  onSelect: (key: AddDataCardKey) => void;
}) {
  const cards: { key: AddDataCardKey; title: string; desc: string }[] = [
    { key: "connect", title: copy.connectTitle, desc: copy.connectDesc },
    { key: "import", title: copy.importTitle, desc: copy.importDesc },
    { key: "manual", title: copy.manualTitle, desc: copy.manualDesc },
    { key: "skip", title: copy.skipTitle, desc: copy.skipDesc },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(c.key)}
          className="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted">
            <Icon d={CARD_ICONS[c.key]} size={17} className="text-success" />
          </span>
          <span>
            <div className="text-sm font-bold text-foreground">{c.title}</div>
            <div className="mt-0.5 text-xs/snug font-medium text-text-2">{c.desc}</div>
          </span>
        </button>
      ))}
    </div>
  );
}
