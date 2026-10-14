import { Icon, ICONS } from "../icon";
import { choiceCardClass } from "../choice-card";

export interface TaxOptionCopy {
  code: "DE" | "ID";
  name: string;
  desc: string;
}

/** Step 2 — Tax regime: DE / ID selectable cards. */
export function TaxStep({
  options,
  taxRegime,
  onSelect,
}: {
  options: TaxOptionCopy[];
  taxRegime: "DE" | "ID";
  onSelect: (regime: "DE" | "ID") => void;
}) {
  return (
    <div className="mb-6.5 flex flex-col gap-2.5">
      {options.map((o) => {
        const selected = o.code === taxRegime;
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => onSelect(o.code)}
            className={choiceCardClass(selected)}
          >
            <div className="flex items-center justify-between gap-2.5">
              <span className="flex items-center gap-2.5">
                <span className="rounded-xs bg-muted px-2 py-1 font-mono text-xs font-bold text-success">
                  {o.code}
                </span>
                <span className="text-sm font-bold text-foreground">{o.name}</span>
              </span>
              {selected && (
                <Icon d={ICONS.check} size={18} strokeWidth={2.4} className="text-primary" />
              )}
            </div>
            <p className="mt-2 text-xs/normal font-medium text-text-2">{o.desc}</p>
          </button>
        );
      })}
    </div>
  );
}
