import * as fsx from "@/platform/fsx";
import type { EditorHandle, ViewMode } from "@/editor/editor";
import { Doc, type EditorPort } from "@/core/doc";
import { isMac } from "@/lib/utils";
import type { BannerActions } from "./components/Banner";
import { ask } from "./components/ConfirmHost";
import type { MenuItem, Rename } from "./components/Sidebar";
import * as recents from "@/core/recents";
import { createTheme } from "@/platform/theme";
import { baseName, buildTree, joinPath, parentOf, reconcile, uniqueName, validName, walkMd, withMdExt, type TreeNode } from "@/core/tree";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_DEFAULT = 260;
// The editor keeps at least half the window; the saved width is kept as-is and only clamped for display.
const clampWidth = (px: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(px, window.innerWidth / 2)));

const within = (p: string, base: string) => p === base || p.startsWith(base + "/");

// The app's state lives here, outside React; `render` re-draws the views from it. Replaced objects
// (tree, expanded) are new references so the memoized Sidebar skips keystroke renders.
export function createApp(render: () => void) {
  const treeIO = { stat: fsx.stat, readDir: fsx.list };
  const s = {
    root: null as string | null,
    tree: [] as TreeNode[],
    expanded: new Set<string>(),
    active: null as string | null,
    status: null as { text: string; retry?: () => void } | null,
    renaming: null as Rename | null,
    recentFolders: [] as string[],
    recentFiles: [] as recents.RecentFile[],
    view: "formatted" as ViewMode,
    /** Saved sidebar width; shown clamped to the current window. */
    sidebarWidth: SIDEBAR_DEFAULT,
    /** True until startup has restored the last folder/file, so the welcome screen doesn't flash first. */
    restoring: true,
    /** A folder is being read; the app is covered and takes no input. */
    loading: false,
  };
  const files = new Set<string>();
  let unwatch: (() => void) | null = null;
  /** Bumped by every folder open; an open whose number is no longer current drops its result. */
  let opening = 0;
  let lastTitle = "";

  const theme = createTheme(() => { syncWindowTheme(); editor?.themeChanged(); render(); });
  const syncWindowTheme = () => void fsx.setWindowTheme(theme.mode === "system" ? null : theme.mode);
  const editorEl = document.createElement("div");
  editorEl.style.height = "100%";
  // CodeMirror is its own chunk (~700 kB), so the shell paints before it loads. Doc only touches the
  // editor once a file is open, and switchTo waits for `editorReady` before opening one.
  let editor: EditorHandle | null = null;
  const editorReady = import("@/editor/editor").then(({ createEditor }) => {
    editor = createEditor(editorEl, { onUserEdit: syncTitle });
    editor.setReadOnly(true);
  });
  const port: EditorPort = {
    getText: () => editor!.getText(),
    load: (text) => editor!.load(text),
    applyExternal: (text) => editor!.applyExternal(text),
    setReadOnly: (ro) => editor!.setReadOnly(ro),
  };
  const doc = new Doc({ read: fsx.readText, write: fsx.writeText }, port, () => refresh());

  function syncTitle() {
    const title = doc.path ? `${doc.dirty ? "● " : ""}${baseName(doc.path)}` : "md-reader";
    if (title !== lastTitle) { lastTitle = title; void fsx.setTitle(title); }
  }

  function refresh() {
    syncTitle();
    render();
  }

  function renderTree() {
    if (s.root) s.tree = buildTree(s.root, files);
    render();
  }

  function setActive(path: string | null) {
    s.active = path;
    s.expanded = new Set(s.expanded);
    for (let d = path ? parentOf(path) : ""; d; d = parentOf(d)) s.expanded.add(d);
    render();
  }

  function setStatus(text: string | null, retry?: () => void) {
    s.status = text ? { text, retry } : null;
    render();
  }

  function toggle(path: string) {
    s.expanded = new Set(s.expanded);
    if (!s.expanded.delete(path)) s.expanded.add(path);
    render();
  }

  function remember() {
    void fsx.saveSettings({
      lastFolder: s.root ?? undefined,
      lastFile: doc.path ?? undefined,
      recentFolders: s.recentFolders,
      recentFiles: s.recentFiles,
      sidebarWidth: s.sidebarWidth,
    });
  }

  function forgetRecent(path: string) {
    s.recentFolders = s.recentFolders.filter((p) => p !== path);
    s.recentFiles = s.recentFiles.filter((f) => f.path !== path);
    render();
    remember();
  }

  async function guardUnsaved(): Promise<boolean> {
    if (!doc.dirty) return true;
    const choice = await ask({
      title: `Save changes to “${baseName(doc.path!)}”?`,
      description: "Your changes will be lost if you don't save them.",
      actions: [{ key: "discard", label: "Discard", variant: "outline" }, { key: "save", label: "Save" }],
    });
    if (choice === "cancel") return false;
    if (choice === "discard") return true;
    await (doc.banner?.kind === "deleted" ? doc.recreate() : doc.save());
    return !doc.dirty;
  }

  async function switchTo(path: string) {
    if (path === doc.path || !(await guardUnsaved())) return;
    await editorReady;
    await doc.open(path);
    if (s.root) s.recentFiles = recents.touch(s.recentFiles, { path, root: s.root }, 8);
    editor!.setImageBase(fsx.assetUrl(parentOf(path)));
    setActive(path);
    editor!.focus();
    remember();
  }

  async function closeDoc() {
    if (!(await guardUnsaved())) return;
    doc.close();
    setActive(null);
    remember();
  }

  async function openFolder(dir: string): Promise<boolean> {
    if (!(await guardUnsaved())) return false;
    const me = ++opening;
    unwatch?.();
    unwatch = null;
    if (doc.path) doc.close();
    s.root = dir;
    s.recentFolders = recents.touch(s.recentFolders, dir, 5);
    s.loading = true;
    render();
    try {
      // Untrusted folder → readDir fails anyway and the tree comes up empty.
      await fsx.grantHidden(dir).catch(() => {});
      const found = await walkMd(dir, dir, fsx.list);
      if (me !== opening) return false; // a newer open took over
      files.clear();
      found.forEach((f) => files.add(f));
      setActive(null);
      renderTree();
      await startWatch();
      if (me !== opening) return false; // a newer open started while the watcher came up
      remember();
      return true;
    } finally {
      if (me === opening) {
        s.loading = false;
        render();
      }
    }
  }

  // The welcome screen checked existence when it rendered; the file may have gone since.
  async function openRecentFile(f: recents.RecentFile) {
    if (!(await fsx.pathExists(f.path).catch(() => false))) return forgetRecent(f.path);
    if (f.root !== s.root && !(await openFolder(f.root))) return;
    await switchTo(f.path);
  }

  async function pickFolder() {
    const dir = await fsx.pickFolder();
    if (dir) await openFolder(dir);
  }

  async function startWatch() {
    const me = opening;
    if (!s.root) return;
    try {
      const stop = await fsx.watchFolder(s.root, onPaths);
      if (me !== opening) return stop(); // another open (even of this folder) started meanwhile
      unwatch = stop;
      setStatus(null);
    } catch (e) {
      setStatus(`Not watching: ${e}`, () => void startWatch());
    }
  }

  // Coalesce watcher callbacks into one batch, and process batches strictly in order.
  const pending = new Set<string>();
  let flushTimer = 0;
  let queue: Promise<void> = Promise.resolve();
  function onPaths(paths: string[]) {
    paths.forEach((p) => pending.add(p));
    clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      queue = queue.then(() => rescan(batch)).catch((e) => console.error(e));
    }, 20);
  }

  async function rescan(paths: string[]) {
    if (!s.root) return;
    if (await reconcile(files, s.root, paths, treeIO)) renderTree();
    if (doc.path && paths.includes(doc.path)) await doc.onDiskChanged();
  }

  async function namesIn(dir: string) {
    return new Set((await fsx.list(dir)).map((e) => e.name));
  }

  function menuFor(node: TreeNode | null): MenuItem[] {
    if (!s.root) return [];
    const dir = !node ? s.root : node.children ? node.path : parentOf(node.path);
    const items: MenuItem[] = [
      { text: "New File", action: () => void newFile(dir) },
      { text: "New Folder", action: () => void newFolder(dir) },
    ];
    if (node) {
      items.push({ text: "Rename", action: () => renameNode(node) });
      items.push({ text: "Move to Trash", action: () => void trashNode(node), destructive: true });
    }
    return items;
  }

  async function newFile(dir: string) {
    const path = joinPath(dir, uniqueName("untitled", ".md", await namesIn(dir)));
    await fsx.writeText(path, "");
    await rescan([path]);
    await switchTo(path);
    renameNode({ name: baseName(path), path, children: null });
  }

  // Empty folders are hidden, so a new folder gets an untitled.md inside it.
  async function newFolder(dir: string) {
    const folder = joinPath(dir, uniqueName("New Folder", "", await namesIn(dir)));
    await fsx.makeDir(folder);
    const file = joinPath(folder, "untitled.md");
    await fsx.writeText(file, "");
    await rescan([folder]);
    await switchTo(file);
    renameNode({ name: baseName(folder), path: folder, children: [] });
  }

  function endRename() {
    s.renaming = null;
    render();
  }

  function renameNode(node: TreeNode) {
    s.renaming = {
      path: node.path,
      async commit(raw) {
        const err = validName(raw);
        if (err) return err;
        const name = node.children ? raw.trim() : withMdExt(raw.trim());
        const target = joinPath(parentOf(node.path), name);
        if (target === node.path) return null;
        if (await fsx.pathExists(target)) return "Already exists";
        try {
          await fsx.move(node.path, target);
        } catch (e) {
          return String(e);
        }
        if (doc.path && within(doc.path, node.path)) {
          doc.moveTo(target + doc.path.slice(node.path.length));
          setActive(doc.path);
        }
        s.recentFiles = recents.move(s.recentFiles, node.path, target);
        s.recentFolders = recents.move(s.recentFolders, node.path, target);
        await rescan([node.path, target]);
        remember();
        return null;
      },
    };
    render();
  }

  async function trashNode(node: TreeNode) {
    const choice = await ask({
      title: `Move “${node.name}” to Trash?`,
      description: node.children ? "The folder and everything in it go to the Trash." : "You can restore it from the Trash.",
      actions: [{ key: "trash", label: "Move to Trash", variant: "destructive" }],
    });
    if (choice !== "trash") return;
    const affectsOpen = doc.path !== null && within(doc.path, node.path);
    if (affectsOpen && !(await guardUnsaved())) return;
    try {
      await fsx.trash(node.path);
    } catch (e) {
      setStatus(`Couldn't move to Trash: ${e}`);
      return;
    }
    if (affectsOpen) { doc.close(); setActive(null); }
    s.recentFiles = recents.remove(s.recentFiles, node.path);
    await rescan([node.path]);
    remember();
  }

  const actions: BannerActions = {
    reload: () => void doc.reload(),
    copy: () => void doc.saveCopy(),
    keep: () => doc.keep(),
    recreate: () => void doc.recreate(),
    close: () => void closeDoc(),
    dismiss: () => doc.dismiss(),
  };

  const sidebar = {
    open: (p: string) => void switchTo(p),
    toggle,
    menu: menuFor,
    endRename,
  };

  const resize = {
    width: () => clampWidth(s.sidebarWidth),
    set(px: number) { s.sidebarWidth = clampWidth(px); render(); },
    // Not while startup restore is pending: remember() would save empty recents over the real ones.
    commit() { if (!s.restoring) remember(); },
    reset() { resize.set(SIDEBAR_DEFAULT); resize.commit(); },
  };

  function toggleView() {
    if (!doc.path) return;
    s.view = s.view === "formatted" ? "source" : "formatted";
    editor!.setMode(s.view);
    render();
  }

  function start() {
    const onKey = (e: KeyboardEvent) => {
      if (s.loading || !(e.metaKey || e.ctrlKey)) return;
      if (e.key === "s") { e.preventDefault(); void doc.save(); }
      if (e.key === "o") { e.preventDefault(); void pickFolder(); }
      // Platform key only: on macOS, Ctrl+E is CodeMirror's end-of-line.
      if (e.key === "e" && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); toggleView(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", render);
    fsx.onCloseRequested(guardUnsaved);
    syncWindowTheme();
    void (async () => {
      try {
        const st = await fsx.loadSettings();
        s.recentFolders = st.recentFolders ?? [];
        s.recentFiles = st.recentFiles ?? [];
        if (Number.isFinite(st.sidebarWidth)) s.sidebarWidth = st.sidebarWidth!;
      } finally {
        s.restoring = false;
        refresh();
      }
    })();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", render);
      unwatch?.();
    };
  }

  const welcome = {
    pickFolder: () => void pickFolder(),
    newFile: () => { if (s.root) void newFile(s.root); },
    openFolder: (dir: string) => void openFolder(dir),
    openFile: (f: recents.RecentFile) => void openRecentFile(f),
    remove: forgetRecent,
  };

  return { s, doc, editorEl, exists: fsx.pathExists, actions, sidebar, resize, welcome, theme, pickFolder, toggleView, start };
}
