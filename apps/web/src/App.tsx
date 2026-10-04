import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Code, Eye, FolderOpen, LoaderCircle, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isMac } from "@/lib/utils";
import { createApp, SIDEBAR_MIN } from "./controller";
import type { ViewMode } from "@/editor/editor";
import { Banner } from "./components/Banner";
import { ConfirmHost } from "./components/ConfirmHost";
import { Editor } from "./components/Editor";
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
      <aside id="sidebar" className="relative flex flex-none flex-col border-r bg-sidebar text-sidebar-foreground" style={{ width: app.resize.width() }}>
        <header className="flex h-11 items-center border-b px-2">
          <Button id="open-folder" variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => void app.pickFolder()}>
            <FolderOpen aria-hidden />
            Open Folder…
          </Button>
          <AppearanceButton mode={app.theme.mode} onClick={app.theme.cycle} />
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
      <main className="flex min-w-0 flex-1 flex-col">
        <Banner banner={doc.banner} actions={app.actions} />
        {!doc.path && !s.restoring && (
          <Welcome folder={s.root} folders={s.recentFolders} files={s.recentFiles} exists={app.exists} on={app.welcome} />
        )}
        {/* Wrapper anchors the button to the editor, below the banner. */}
        <div className="relative flex min-h-0 flex-1 flex-col" hidden={!doc.path}>
          <Editor el={app.editorEl} />
          {doc.path && <ViewModeButton mode={s.view} onClick={app.toggleView} />}
        </div>
      </main>
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

const viewKey = isMac ? "⌘E" : "Ctrl+E";
const viewButton: Record<ViewMode, [typeof Code, string]> = { formatted: [Code, "Show source"], source: [Eye, "Show formatted"] };

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
