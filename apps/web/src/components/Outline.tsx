import { ListTree, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, isMac } from "@/lib/utils";
import type { HeadingItem } from "@/core/outline";

export type OutlineViewState = {
  open: boolean;
  items: HeadingItem[];
};

export type OutlineActions = {
  toggle(): void;
  jump(from: number): void;
  close(): void;
};

const outlineKey = isMac ? "⇧⌘O" : "Ctrl+Shift+O";

export function OutlineButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button
      id="outline-toggle"
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle outline"
      aria-pressed={open}
      title={`Toggle outline (${outlineKey})`}
      className={cn(
        "absolute top-2 right-11 opacity-40 hover:opacity-100 focus-visible:opacity-100",
        open && "bg-accent text-accent-foreground opacity-100",
      )}
      onClick={onClick}
    >
      <ListTree aria-hidden />
    </Button>
  );
}

export function OutlinePanel({ state, on }: { state: OutlineViewState; on: OutlineActions }) {
  if (!state.open) return null;

  const minLevel = state.items.reduce((min, h) => Math.min(min, h.level), 6);

  return (
    <aside
      id="outline-panel"
       aria-label="Document outline"
      className="absolute top-11 right-3 z-10 flex max-h-[calc(100%-3.5rem)] w-64 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-sm"
    >
      <header className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Outline</span>
        <Button
          id="outline-close"
          variant="ghost"
          size="icon-xs"
          aria-label="Close outline"
          title="Close outline"
          onClick={on.close}
        >
          <X aria-hidden />
        </Button>
      </header>
      {state.items.length > 0 ? (
        <ul className="flex-1 overflow-auto p-1">
          {state.items.map((h, i) => (
            <li key={`${h.from}-${i}`}>
              <button
                type="button"
                data-outline-item
                data-level={h.level}
                data-slug={h.slug}
                style={{ paddingLeft: 8 + Math.max(0, h.level - minLevel) * 12 }}
                className="flex w-full items-center rounded px-2 py-1 text-left text-[13px] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
                onClick={() => on.jump(h.from)}
              >
                <span className="truncate">{h.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div id="outline-empty" className="px-3 py-4 text-center text-xs text-muted-foreground">
          No headings
        </div>
      )}
    </aside>
  );
}
