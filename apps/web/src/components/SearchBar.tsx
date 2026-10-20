import { useLayoutEffect, useRef } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Match } from "@/core/search";

export type SearchViewState = {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  matches: Match[];
  activeIndex: number;
  focusSeq: number;
};

export type SearchActions = {
  setQuery(query: string): void;
  toggleCase(): void;
  next(): void;
  prev(): void;
  close(): void;
};

export function SearchBar({ state, on }: { state: SearchViewState; on: SearchActions }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!state.open || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [state.open, state.focusSeq]);

  if (!state.open) return null;

  const total = state.matches.length;
  const countLabel = !state.query
    ? ""
    : total === 0
      ? "No results"
      : `${state.activeIndex + 1} of ${total}`;

  return (
    <div
      id="search-bar"
      role="search"
      aria-label="Find in document"
      className="absolute top-2 right-12 z-10 flex h-8 items-center gap-1 rounded-md border bg-popover px-1.5 text-popover-foreground shadow-sm"
    >
      <input
        ref={inputRef}
        id="search-input"
        type="text"
        value={state.query}
        placeholder="Find…"
        aria-label="Find in document"
        className="h-6 w-44 bg-transparent px-1.5 text-[13px] outline-none placeholder:text-muted-foreground"
        onChange={(e) => on.setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            on.close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) on.prev();
            else on.next();
          }
        }}
      />
      <span
        id="search-count"
        aria-live="polite"
        className={cn(
          "min-w-16 px-1 text-right text-xs tabular-nums select-none",
          state.query && total === 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {countLabel}
      </span>
      <Button
        id="search-case"
        variant="ghost"
        size="icon-xs"
        aria-label="Match case"
        aria-pressed={state.caseSensitive}
        title="Match case"
        className={cn(state.caseSensitive && "bg-accent text-accent-foreground")}
        onClick={on.toggleCase}
      >
        <CaseSensitive aria-hidden />
      </Button>
      <Button
        id="search-prev"
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={total === 0}
        onClick={on.prev}
      >
        <ChevronUp aria-hidden />
      </Button>
      <Button
        id="search-next"
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={total === 0}
        onClick={on.next}
      >
        <ChevronDown aria-hidden />
      </Button>
      <Button
        id="search-close"
        variant="ghost"
        size="icon-xs"
        aria-label="Close search"
        title="Close (Escape)"
        onClick={on.close}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
