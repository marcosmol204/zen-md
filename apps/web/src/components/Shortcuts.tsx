import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, isMac } from "@/lib/utils";

export type ShortcutsViewState = {
  open: boolean;
};

export type ShortcutsActions = {
  toggle(): void;
  close(): void;
};

export type ShortcutEntry = {
  label: string;
  keys: string;
};

export type ShortcutGroup = {
  title: string;
  items: ShortcutEntry[];
};

const shortcutsKey = isMac ? "⌘/" : "Ctrl+/";

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Workspace",
    items: [
      { label: "Open folder", keys: isMac ? "⌘O" : "Ctrl+O" },
      { label: "Quick file switcher", keys: isMac ? "⌘P" : "Ctrl+P" },
      { label: "Toggle sidebar", keys: isMac ? "⌘B" : "Ctrl+B" },
      { label: "Keyboard shortcuts", keys: shortcutsKey },
    ],
  },
  {
    title: "Document",
    items: [
      { label: "Save file", keys: isMac ? "⌘S" : "Ctrl+S" },
      { label: "Toggle Formatted / Source view", keys: isMac ? "⌘E" : "Ctrl+E" },
      { label: "Toggle document outline", keys: isMac ? "⇧⌘O" : "Ctrl+Shift+O" },
      { label: "Find in document", keys: isMac ? "⌘F" : "Ctrl+F" },
    ],
  },
  {
    title: "Editing & Navigation",
    items: [
      { label: "Slash commands (Source mode)", keys: "/" },
      { label: "Undo", keys: isMac ? "⌘Z" : "Ctrl+Z" },
      { label: "Redo", keys: isMac ? "⇧⌘Z" : "Ctrl+Shift+Z" },
      { label: "Next / previous search match", keys: isMac ? "Enter / ⇧Enter" : "Enter / Shift+Enter" },
      { label: "Close dialog or bar", keys: "Esc" },
    ],
  },
];

export function ShortcutsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button
      id="shortcuts-button"
      variant="ghost"
      size="icon-sm"
      aria-label="Keyboard shortcuts"
      aria-expanded={open}
      title={`Keyboard shortcuts (${shortcutsKey})`}
      className={cn(
        "font-semibold text-muted-foreground hover:text-foreground",
        open && "bg-accent text-accent-foreground",
      )}
      onClick={onClick}
    >
      ?
    </Button>
  );
}

export function ShortcutsModal({ state, on }: { state: ShortcutsViewState; on: ShortcutsActions }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (state.open) closeRef.current?.focus();
  }, [state.open]);

  if (!state.open) return null;

  return (
    <div
      id="shortcuts-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/40 p-4 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) on.close();
      }}
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <Button
            ref={closeRef}
            id="shortcuts-close"
            variant="ghost"
            size="icon-xs"
            aria-label="Close shortcuts"
            title="Close (Escape)"
            onClick={on.close}
          >
            <X aria-hidden />
          </Button>
        </header>
        <div className=" flex max-h-[70vh] flex-col gap-4 overflow-auto p-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    data-shortcut-item
                    className="flex items-center justify-between rounded-md px-2 py-1 text-[13px]"
                  >
                    <span>{item.label}</span>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
