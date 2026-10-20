import * as fsx from "@/platform/fsx";
import type { EditorHandle, ViewMode } from "@/editor/editor";
import { Doc, type EditorPort } from "@/core/doc";
import { resolveMarkdownLink } from "@/core/links";
import { extractHeadings, slugifyHeading } from "@/core/outline";
import { activeMatchIndex, findMatches, stepMatchIndex } from "@/core/search";
import { filterFiles } from "@/core/switcher";
import { isMac } from "@/lib/utils";
import type { BannerActions } from "./components/Banner";
import { ask } from "./components/ConfirmHost";
import type { OutlineActions, OutlineViewState } from "./components/Outline";
import type { QuickSwitcherActions, QuickSwitcherViewState } from "./components/QuickSwitcher";
import type { SearchActions, SearchViewState } from "./components/SearchBar";
import type { MenuItem, Rename } from "./components/Sidebar";
import * as recents from "@/core/recents";
import { createTheme } from "@/platform/theme";
import { baseName, buildTree, joinPath, parentOf, reconcile, relativePath, uniqueName, validName, walkMd, withMdExt, type TreeNode } from "@/core/tree";

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
    search: {
      open: false,
      query: "",
      caseSensitive: false,
      matches: [],
      activeIndex: -1,
      focusSeq: 0,
    } as SearchViewState,
    switcher: {
      open: false,
      query: "",
      items: [],
      activeIndex: -1,
      focusSeq: 0,
    } as QuickSwitcherViewState,
    outline: {
      open: false,
      items: [],
    } as OutlineViewState,
    /** Saved sidebar width; shown clamped to the current window. */
    sidebarWidth: SIDEBAR_DEFAULT,
    sidebarCollapsed: false,
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
    editor = createEditor(editorEl, {
      onUserEdit: syncTitle,
      onDocChange: () => {
        if (s.search.open) {
          runSearch({ resetIndex: false, scroll: false });
        }
        if (s.outline.open) {
          runOutline();
        }
        if (s.search.open || s.outline.open) render();
      },
      onLinkClick: (href) => void openLink(href),
      onCopyCode: (code) => void fsx.writeClipboard(code),
    });
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
    if (s.switcher.open) runSwitcher(false);
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
    if (s.restoring) return;
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

  async function switchTo(path: string): Promise<boolean> {
    if (path !== doc.path) {
      if (!(await guardUnsaved())) return false;
      await editorReady;
      await doc.open(path);
      if (s.root) s.recentFiles = recents.touch(s.recentFiles, { path, root: s.root }, 8);
      editor!.setImageBase(fsx.assetUrl(parentOf(path)));
      setActive(path);
      if (s.outline.open) runOutline();
      if (!s.search.open) editor!.focus();
      remember();
    }
    return true;
  }

  async function openLink(href: string) {
    if (!doc.path || !s.root) return;
    const resolved = resolveMarkdownLink(href, doc.path, s.root, files);
    if (!resolved) return;
    if (resolved.path !== doc.path) {
      if (!files.has(resolved.path) && !(await fsx.pathExists(resolved.path).catch(() => false))) return;
      if (!(await switchTo(resolved.path))) return;
    }
    if (resolved.anchor && editor) {
      const targetSlug = slugifyHeading(resolved.anchor);
      const rawLower = resolved.anchor.toLowerCase();
      const headings = extractHeadings(editor.getText());
      const match = headings.find((h) => h.slug === rawLower || h.slug === targetSlug);
      if (match) editor.scrollToPos(match.from);
    }
  }

  function resetSearch() {
    s.search = { ...s.search, open: false, matches: [], activeIndex: -1 };
    editor?.setSearchHighlights([], -1, false);
  }

  function resetSwitcher() {
    s.switcher = { ...s.switcher, open: false, query: "", items: [], activeIndex: -1 };
  }

  function resetOutline() {
    s.outline = { open: false, items: [] };
  }

  async function closeDoc() {
    if (!(await guardUnsaved())) return;
    resetSearch();
    resetOutline();
    doc.close();
    setActive(null);
    remember();
  }

  async function openFolder(dir: string): Promise<boolean> {
    if (!(await guardUnsaved())) return false;
    const me = ++opening;
    unwatch?.();
    unwatch = null;
    resetSearch();
    resetSwitcher();
    resetOutline();
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
      items.push({ text: "Copy path", action: () => void fsx.writeClipboard(node.path) });
      items.push({ text: "Copy relative path", action: () => void fsx.writeClipboard(relativePath(node.path, s.root!)) });
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
    if (affectsOpen) { resetSearch(); doc.close(); setActive(null); }
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

  function toggleSidebar() {
    s.sidebarCollapsed = !s.sidebarCollapsed;
    render();
  }

  function toggleView() {
    if (!doc.path) return;
    s.view = s.view === "formatted" ? "source" : "formatted";
    editor!.setMode(s.view);
    render();
  }

  function runSearch(opts: { resetIndex: boolean; scroll: boolean }) {
    if (!s.search.open || !doc.path || !editor || !s.search.query) {
      s.search = { ...s.search, matches: [], activeIndex: -1 };
      editor?.setSearchHighlights([], -1, false);
      return;
    }
    const matches = findMatches(editor.getText(), s.search.query, { caseSensitive: s.search.caseSensitive });
    let activeIndex = s.search.activeIndex;
    if (matches.length === 0) activeIndex = -1;
    else if (opts.resetIndex || activeIndex < 0 || activeIndex >= matches.length) {
      activeIndex = activeMatchIndex(matches, editor.getSelectionStart());
    }
    s.search = { ...s.search, matches, activeIndex };
    editor.setSearchHighlights(matches, activeIndex, opts.scroll);
  }

  function openSearch() {
    if (!doc.path) return;
    const wasOpen = s.search.open;
    s.search = { ...s.search, open: true, focusSeq: s.search.focusSeq + 1 };
    if (!wasOpen && s.search.query) runSearch({ resetIndex: true, scroll: true });
    render();
  }

  const search: SearchActions = {
    setQuery(query) {
      s.search = { ...s.search, query };
      runSearch({ resetIndex: true, scroll: true });
      render();
    },
    toggleCase() {
      s.search = { ...s.search, caseSensitive: !s.search.caseSensitive };
      runSearch({ resetIndex: true, scroll: true });
      render();
    },
    next() {
      if (!s.search.matches.length) return;
      const activeIndex = stepMatchIndex(s.search.matches.length, s.search.activeIndex, 1);
      s.search = { ...s.search, activeIndex };
      editor?.setSearchHighlights(s.search.matches, activeIndex, true);
      render();
    },
    prev() {
      if (!s.search.matches.length) return;
      const activeIndex = stepMatchIndex(s.search.matches.length, s.search.activeIndex, -1);
      s.search = { ...s.search, activeIndex };
      editor?.setSearchHighlights(s.search.matches, activeIndex, true);
      render();
    },
    close() {
      if (!s.search.open) return;
      resetSearch();
      render();
      editor?.focus();
    },
  };

  function runSwitcher(resetIndex: boolean) {
    if (!s.switcher.open || !s.root) {
      s.switcher = { ...s.switcher, items: [], activeIndex: -1 };
      return;
    }
    const items = filterFiles(
      files,
      s.root,
      s.switcher.query,
      s.recentFiles.map((f) => f.path),
    );
    const activeIndex = items.length === 0
      ? -1
      : resetIndex || s.switcher.activeIndex < 0 || s.switcher.activeIndex >= items.length
        ? 0
        : s.switcher.activeIndex;
    s.switcher = { ...s.switcher, items, activeIndex };
  }

  function openSwitcher() {
    if (!s.root) return;
    s.switcher = { ...s.switcher, open: true, query: "", focusSeq: s.switcher.focusSeq + 1 };
    runSwitcher(true);
    render();
  }

  const switcher: QuickSwitcherActions = {
    setQuery(query) {
      s.switcher = { ...s.switcher, query };
      runSwitcher(true);
      render();
    },
    step(delta) {
      if (!s.switcher.items.length) return;
      const activeIndex = stepMatchIndex(s.switcher.items.length, s.switcher.activeIndex, delta);
      s.switcher = { ...s.switcher, activeIndex };
      render();
    },
    pick(path) {
      resetSwitcher();
      render();
      void switchTo(path);
    },
    close() {
      if (!s.switcher.open) return;
      resetSwitcher();
      render();
      if (doc.path && !s.search.open) editor?.focus();
    },
  };

  function runOutline() {
    if (!s.outline.open || !doc.path || !editor) {
      s.outline = { ...s.outline, items: [] };
      return;
    }
    s.outline = { ...s.outline, items: extractHeadings(editor.getText()) };
  }

  function toggleOutline() {
    if (!doc.path) return;
    const nextOpen = !s.outline.open;
    s.outline = { ...s.outline, open: nextOpen };
    if (nextOpen) runOutline();
    render();
  }

  const outline: OutlineActions = {
    toggle: toggleOutline,
    jump(from) {
      editor?.scrollToPos(from);
    },
    close() {
      if (!s.outline.open) return;
      s.outline = { ...s.outline, open: false };
      render();
      if (doc.path && !s.search.open) editor?.focus();
    },
  };

  function start() {
    const onKey = (e: KeyboardEvent) => {
      if (s.loading || !(e.metaKey || e.ctrlKey)) return;
      if (e.key === "s") { e.preventDefault(); void doc.save(); }
      if (e.key.toLowerCase() === "o" && e.shiftKey && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); toggleOutline(); return; }
      if (e.key === "o" && !e.shiftKey) { e.preventDefault(); void pickFolder(); }
      // Platform key only: on macOS, Ctrl+E is CodeMirror's end-of-line, Ctrl+F is forward-char.
      if (e.key === "e" && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); toggleView(); }
      if (e.key === "f" && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); openSearch(); }
      if (e.key === "p" && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); openSwitcher(); }
      if (e.key === "b" && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); toggleSidebar(); }
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

  return { s, doc, editorEl, exists: fsx.pathExists, actions, sidebar, resize, welcome, theme, search, switcher, outline, pickFolder, toggleView, toggleSidebar, start };
}
