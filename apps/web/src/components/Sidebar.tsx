import { memo, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/core/tree";

export type MenuItem = { text: string; action(): void; destructive?: boolean };
export type Rename = { path: string; commit(name: string): Promise<string | null> };
type Handlers = {
  open(path: string): void;
  toggle(path: string): void;
  /** Context-menu items for a node, or for the folder root when null; empty when no folder is open. */
  menu(node: TreeNode | null): MenuItem[];
  endRename(): void;
};
type Props = {
  tree: TreeNode[];
  active: string | null;
  expanded: Set<string>;
  status: { text: string; retry?: () => void } | null;
  renaming: Rename | null;
  on: Handlers;
};

export const Sidebar = memo(function Sidebar({ tree, active, expanded, status, renaming, on }: Props) {
  const [target, setTarget] = useState<TreeNode | null>(null);
  const chosen = useRef<(() => void) | null>(null);
  const items = on.menu(target);
  const rows = (nodes: TreeNode[], depth: number): React.ReactNode[] =>
    nodes.flatMap((n) => {
      const isDir = n.children !== null;
      const open = isDir && expanded.has(n.path);
      const row = (
        <div
          key={n.path}
          data-path={n.path}
          className={cn(
            "row mx-2 flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 text-[13px] whitespace-nowrap hover:bg-sidebar-accent",
            n.path === active && "active bg-brand/12 font-medium hover:bg-brand/15",
          )}
          style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => (isDir ? on.toggle(n.path) : on.open(n.path))}
          onContextMenu={() => setTarget(n)}
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 flex-none text-muted-foreground transition-transform", open && "rotate-90", !isDir && "invisible")}
          />
          {isDir
            ? (open ? <FolderOpen aria-hidden className="size-4 flex-none text-muted-foreground" /> : <Folder aria-hidden className="size-4 flex-none text-muted-foreground" />)
            : <FileText aria-hidden className={cn("size-4 flex-none", n.path === active ? "text-brand" : "text-muted-foreground")} />}
          {renaming?.path === n.path
            ? <RenameInput name={n.name} rename={renaming} done={on.endRename} />
            : <span className="label truncate">{n.name}</span>}
        </div>
      );
      return open ? [row, ...rows(n.children!, depth + 1)] : [row];
    });

  return (
    <>
      {status && (
        <div id="status" className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="flex-1">{status.text}</span>
          {status.retry && <Button variant="outline" size="xs" onClick={status.retry}>Retry</Button>}
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={on.menu(null).length === 0}>
          <nav
            id="tree"
            className="flex-1 overflow-auto py-2 select-none"
            onContextMenu={(e) => { if (e.target === e.currentTarget) setTarget(null); }}
          >
            {rows(tree, 0)}
          </nav>
        </ContextMenuTrigger>
        {/* The chosen item runs once the menu has closed and released its focus trap; otherwise the trap
            pulls focus back from the inline-rename input that New File / Rename opens, cancelling it. */}
        <ContextMenuContent
          className="min-w-44"
          onCloseAutoFocus={(e) => { e.preventDefault(); const run = chosen.current; chosen.current = null; run?.(); }}
        >
          {items.map((i) => [
            i.destructive && <ContextMenuSeparator key={`${i.text}-sep`} />,
            <ContextMenuItem key={i.text} variant={i.destructive ? "destructive" : "default"} onSelect={() => { chosen.current = i.action; }}>{i.text}</ContextMenuItem>,
          ])}
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
});

function RenameInput({ name, rename, done }: { name: string; rename: Rename; done(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  const finish = () => { finished.current = true; done(); };
  useLayoutEffect(() => {
    ref.current!.focus();
    ref.current!.setSelectionRange(0, name.replace(/\.md$/i, "").length);
  }, [name]);
  return (
    <input
      ref={ref}
      defaultValue={name}
      title={error ?? undefined}
      className={cn(
        "rename h-6 w-full min-w-0 rounded-sm border bg-background px-1 outline-none focus:ring-2 focus:ring-ring/40",
        error && "invalid border-destructive ring-2 ring-destructive/30",
      )}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={async (e) => {
        if (e.key === "Escape") finish();
        if (e.key !== "Enter") return;
        const err = await rename.commit(e.currentTarget.value);
        if (err) setError(err);
        else finish();
      }}
      onBlur={() => { if (!finished.current) finish(); }}
    />
  );
}
