import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Code, Eye, FolderOpen, LoaderCircle, Monitor, Moon, PanelLeft, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isMac } from "@/lib/utils";
import { createApp, SIDEBAR_MIN } from "./controller";
import type { ViewMode } from "@/editor/editor";
import { Banner } from "./components/Banner";
import { ConfirmHost } from "./components/ConfirmHost";
import { Editor } from "./components/Editor";
import { OutlineButton, OutlinePanel } from "./components/Outline";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { SearchBar } from "./components/SearchBar";
import { ShortcutsButton, ShortcutsModal } from "./components/Shortcuts";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import type { Mode } from "@/platform/theme";

const modeIcon: Record<Mode, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };
const modeName: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };

export default function App() {
  const [, setTick] = useState(0);
  // flushSync: the DOM reflects app state as soon as it changes, like the imperative views did.
  const [app] = useState(() => createApp(() => flushSync(() => setTick((t) => t + 1))));
  useEffect(() => app.start(), [app]);
  const { s, doc } = app;

  return (
    <>
    <div id="app" className="flex h-full" aria-busy={s.loading} inert={s.loading}>
      <aside
        id="sidebar"
        hidden={s.sidebarCollapsed}
        className="relative flex flex-none flex-col border-r bg-sidebar text-sidebar-foreground"
        style={{ width: app.resize.width() }}
      >
        <header className="flex h-11 items-center border-b px-2">
          <Button id="open-folder" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => void app.pickFolder()}>
            <FolderOpen aria-hidden />
            <span className="truncate">Open Folder…</span>
          </Button>
          <AppearanceButton mode={app.theme.mode} onClick={app.theme.cycle} />
          <ShortcutsButton open={s.shortcuts.open} onClick={app.shortcuts.toggle} />
          <SidebarToggleButton collapsed={false} onClick={app.toggleSidebar} />
        </header>
        <Sidebar
          tree={s.tree}
          active={s.active}
          expanded={s.expanded}
          status={s.status}
          renaming={s.renaming}
          on={app.sidebar}
        />
        <SidebarHandle width={app.resize.width()} resize={app.resize} />
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {s.sidebarCollapsed && (
          <SidebarToggleButton
            collapsed={true}
            onClick={app.toggleSidebar}
            className="absolute top-2 left-3 z-10 opacity-40 hover:opacity-100 focus-visible:opacity-100"
          />
        )}
        <Banner banner={doc.banner} actions={app.actions} />
        {!doc.path && !s.restoring && (
          <Welcome folder={s.root} folders={s.recentFolders} files={s.recentFiles} exists={app.exists} on={app.welcome} />
        )}
        {/* Wrapper anchors the button to the editor, below the banner. */}
        <div className="relative flex min-h-0 flex-1 flex-col" hidden={!doc.path}>
          <Editor el={app.editorEl} />
          {doc.path && <SearchBar state={s.search} on={app.search} />}
          {doc.path && s.view === "formatted" && <PreviewBadge onClick={app.toggleView} />}
          {doc.path && <OutlineButton open={s.outline.open} onClick={app.outline.toggle} />}
          {doc.path && <ViewModeButton mode={s.view} onClick={app.toggleView} />}
          {doc.path && <OutlinePanel state={s.outline} on={app.outline} />}
        </div>
      </main>
      <QuickSwitcher state={s.switcher} on={app.switcher} />
      <ShortcutsModal state={s.shortcuts} on={app.shortcuts} />
      <ConfirmHost />
    </div>
    {s.loading && <LoadingOverlay />}
    </>
  );
}

/** Covers the app while a folder is read. Blocks input at once; fades in only after 200ms, so fast loads don't flash. */
function LoadingOverlay() {
  return (
    <div id="loading" className="loading-overlay fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        Loading…
      </div>
    </div>
  );
}

type Resize = { set(px: number): void; commit(): void; reset(): void };

/** Drag (or ←/→) the sidebar's right edge; the width is saved once per gesture. */
function SidebarHandle({ width, resize }: { width: number; resize: Resize }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const endDrag = () => { if (!drag.current) return; drag.current = null; resize.commit(); };
  return (
    <div
      id="sidebar-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-brand/30 focus-visible:bg-brand/40"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection while dragging
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => { if (drag.current) resize.set(drag.current.width + e.clientX - drag.current.x); }}
      onPointerUp={endDrag}
      // pointercancel / focus loss: no pointerup arrives, but capture is always released.
      onLostPointerCapture={endDrag}
      onDoubleClick={resize.reset}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
        if (step) { e.preventDefault(); resize.set(width + step); }
      }}
      onKeyUp={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") resize.commit(); }}
    />
  );
}

function AppearanceButton({ mode, onClick }: { mode: Mode; onClick: () => void }) {
  const Icon = modeIcon[mode];
  const label = `Appearance: ${modeName[mode]}`;
  return (
    <Button id="appearance" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      <Icon aria-hidden />
    </Button>
  );
}

const sidebarKey = isMac ? "⌘B" : "Ctrl+B";

function SidebarToggleButton({ collapsed, onClick, className }: { collapsed: boolean; onClick: () => void; className?: string }) {
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return (
    <Button
      id="sidebar-toggle"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (${sidebarKey})`}
      className={className}
      onClick={onClick}
    >
      <PanelLeft aria-hidden />
    </Button>
  );
}

const viewKey = isMac ? "⌘E" : "Ctrl+E";
const viewButton: Record<ViewMode, [typeof Code, string]> = { formatted: [Code, "Show source"], source: [Eye, "Show formatted"] };

function PreviewBadge({ onClick }: { onClick: () => void }) {
  const label = `Preview mode (read-only) — switch to edit (${viewKey})`;
  return (
    <button
      id="preview-badge"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute top-2 right-20 z-10 flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground opacity-70 transition-opacity hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 outline-none select-none cursor-pointer"
    >
      <Eye aria-hidden className="size-3.5" />
      <span>Preview</span>
    </button>
  );
}

function ViewModeButton({ mode, onClick }: { mode: ViewMode; onClick: () => void }) {
  const [Icon, label] = viewButton[mode];
  return (
    <Button
      id="view-mode"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={`${label} (${viewKey})`}
      className="absolute top-2 right-3 opacity-40 hover:opacity-100 focus-visible:opacity-100"
      onClick={onClick}
    >
      <Icon aria-hidden />
    </Button>
  );
}
