import { useLayoutEffect, useRef } from "react";
import { FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { parentOf } from "@/core/tree";
import type { SwitcherItem } from "@/core/switcher";

export type QuickSwitcherViewState = {
  open: boolean;
  query: string;
  items: SwitcherItem[];
  activeIndex: number;
  focusSeq: number;
};

export type QuickSwitcherActions = {
  setQuery(query: string): void;
  step(delta: 1 | -1): void;
  pick(path: string): void;
  close(): void;
};

export function QuickSwitcher({ state, on }: { state: QuickSwitcherViewState; on: QuickSwitcherActions }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!state.open || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [state.open, state.focusSeq]);

  useLayoutEffect(() => {
    if (!state.open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>("[data-active=true]");
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }, [state.open, state.activeIndex]);

  if (!state.open) return null;

  return (
    <div
      id="quick-switcher"
      role="dialog"
      aria-modal="true"
      aria-label="Quick file switcher"
      className="fixed inset-0 z-40 flex items-start justify-center bg-background/40 pt-20 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) on.close();
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search aria-hidden className="size-4 flex-none text-muted-foreground" />
          <input
            ref={inputRef}
            id="quick-switcher-input"
            type="text"
            value={state.query}
            placeholder="Go to file…"
            aria-label="Go to file"
            className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => on.setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                on.close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                on.step(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                on.step(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const chosen = state.items[state.activeIndex];
                if (chosen) on.pick(chosen.path);
              }
            }}
          />
        </div>
        {state.items.length > 0 ? (
          <ul ref={listRef} role="listbox" aria-label="Matching files" className="max-h-72 overflow-auto p-1">
            {state.items.map((item, idx) => {
              const isActive = idx === state.activeIndex;
              const dir = item.rel !== item.name ? parentOf(item.rel) : "";
              return (
                <li
                  key={item.path}
                  role="option"
                  aria-selected={isActive}
                  data-switcher-item
                  data-path={item.path}
                  data-active={isActive}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]",
                    isActive ? "bg-brand/12 font-medium text-foreground" : "hover:bg-accent",
                  )}
                  onClick={() => on.pick(item.path)}
                >
                  <FileText aria-hidden className={cn("size-4 flex-none", isActive ? "text-brand" : "text-muted-foreground")} />
                  <span className="truncate">{item.name}</span>
                  {dir && <span className="truncate text-xs text-muted-foreground">{dir}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div id="quick-switcher-empty" className="px-4 py-6 text-center text-xs text-muted-foreground">
            No matching files
          </div>
        )}
      </div>
    </div>
  );
}
