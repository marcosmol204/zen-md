# md-reader — Design

Date: 2026-10-01 · Status: implemented (v1)

## 1. Purpose

A minimal macOS desktop app to read and edit a folder of Markdown files **while AI agents
(Claude Code, Codex, …) write to them**, without flicker, cursor jumps, or lost edits.

**Success criteria**
- Claude streams a 500-line plan into an open file: no flicker, no cursor/scroll jump, view follows the bottom if I was at the bottom.
- I open an agent-written file, edit one line, save: `git diff` shows only that line.
- I never lose an unsaved edit to a disk change, a file switch, or quitting.

## 2. Decisions

| Topic | Decision |
|---|---|
| Disk vs. my edits | Clean buffer → silent live reload. Dirty buffer → banner (Reload / Save mine as copy / Keep mine). |
| Editing | Typora-like live preview, built on CodeMirror 6 (Obsidian-style: syntax hidden except on the cursor's line). |
| File fidelity | The file is the source of truth. Bytes saved exactly as typed. Line endings (LF/CRLF) preserved. |
| Scope | Open a **folder**. Sidebar tree shows only `.md` files, updates live. Sidebar width is drag-resizable (180px–half the window, remembered). |
| File ops | New file, new folder, rename, delete → real OS Trash. |
| Stack | Tauri v2, macOS-first (UI kept OS-neutral for a later Windows build), TypeScript, Vite. View layer: React + shadcn/ui + Tailwind v4 + lucide icons ([ADR 0001](adr/0001-react-shadcn-ui.md)). |
| Rust | Only scaffold plugin registration + one `move_to_trash` command (`trash` crate). Any other Rust need = stop and reconsider. |
| Saving | Manual `Mod-s`. No autosave (it would clobber agent writes). |
| Layout | One window, one editor pane, no tabs. Native title bar. No file open → welcome screen with recent folders/files. |

## 3. Scope

**v1**
- Folder tree (.md only, live), file ops, single editor pane.
- Live preview: headings, emphasis, links, lists, task checkboxes (clickable), blockquotes, inline code,
  code fences with highlighting, **tables, images, Mermaid, math (KaTeX)**.
- Live watcher + conflict banner + tail-follow.
- Formatted / Source view toggle (⌘E or editor top-right button): Source shows the raw markdown in monospace.
- Light / Dark / System appearance (sidebar toggle, System follows macOS). Remember last folder + file.

**v1.1** — outline panel, focus/typewriter mode, folder-wide search.
**v1.2** — export (PDF/HTML), custom CSS themes.

**Out of scope** — tabs, multiple windows, autosave, git integration, CRDT/merge, non-UTF-8 editing.

## 4. Architecture

```
apps/desktop/src-tauri/
  src/lib.rs     registers plugins fs(watch), dialog; command move_to_trash(path) via `trash` crate
  capabilities/default.json   permissions + static scope $APPCONFIG/** (settings only)
apps/web/src/
  main.tsx        mounts <App/>
  App.tsx         view: sidebar, banner, welcome, editor host, appearance + view-mode buttons
  controller.ts   app state + wiring outside React: folder/file ops, watcher batching,
                  keyboard shortcuts, settings, close-request guard
  core/           pure, unit-tested next to each file (*.test.ts)
    text.ts       diffRange, EOL/BOM split/join, UTF-8 decode, conflict-copy name
    tree.ts       .md filter, ignore rules, walk, reconcile watcher paths, buildTree, naming
    doc.ts        open-document state machine (I/O + editor injected): path, disk content,
                  dirty, save, conflict state, banner model
    recents.ts    recent folders/files list (dedupe, newest first, cap, remove)
  editor/
    editor.ts     CM6 setup, live-preview extensions, applyExternal(text), Formatted/Source mode
    tasks.ts      clickable task-list checkboxes
    mermaid.ts    CM6 block widget; lazy-imports `mermaid` only when a ```mermaid block exists
  platform/
    fsx.ts        ONLY module importing Tauri APIs: file I/O, watch, trash, folder picker,
                  window title/theme/close, settings
    theme.ts      appearance mode (System/Light/Dark) in localStorage, `.dark` class on <html>
  components/
    Sidebar.tsx   tree, inline rename, watcher status, shadcn ContextMenu for file ops
    Banner.tsx    renders the banner model
    Welcome.tsx   no-file screen: Open Folder, recent folders/files
    Editor.tsx    mounts the editor/editor.ts CodeMirror view into a ref
    ConfirmHost.tsx  promise-based AlertDialog (Unsaved, Move to Trash)
    ui/           shadcn components (generated, owned by us)
  lib/utils.ts    shadcn `cn()` helper, isMac
  test/           app.test.ts + harness, Node and in-memory fsx stand-ins
  styles.css      Tailwind entry, theme tokens, CodeMirror/editor rules
scripts/
  fake-agent.mjs   streams/edits/creates/deletes files to exercise the app
```

**Boundary rule:** `platform/fsx.ts` is the only seam to the platform. Swapping to Electron = rewriting `fsx.ts`.

**Dependencies**
- Rust: `tauri-plugin-fs` (feature `watch`), `tauri-plugin-dialog`, `trash`.
- JS: `@tauri-apps/api`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`,
  `@codemirror/{state,view,language,lang-markdown,commands}`, `@lezer/markdown`,
  `codemirror-live-markdown` (tables, math, code blocks, images, links), `katex`, `mermaid` (lazy).
- JS (view): `react`, `react-dom`, `tailwindcss` + `@tailwindcss/vite`, shadcn/ui (`radix-ui` primitives, `cn`,
  `class-variance-authority`, `tw-animate-css`), `lucide-react`.
- Dev: `vitest`, `@vitejs/plugin-react`, `happy-dom`, `@playwright/test`.

**Permissions/scope:** per-folder trust. The static `fs:scope` covers only `$APPCONFIG/**` (settings); the
asset-protocol scope starts empty. Picking a folder in the Open dialog (`recursive: true`) grants it to both
scopes, and `tauri-plugin-persisted-scope` remembers the grant across launches. Dot-folders: fs plugin 2.6 matches
dialog grants with unix defaults (`dir/**` never matches `.scratch`) and ignores `requireLiteralLeadingDot` for them,
so `openFolder` calls the `grant_hidden` command, which grants each dot-dir / dot-`.md` inside an already-trusted
folder by literal path (skipping `.git`, `node_modules`). Asset scope uses `requireLiteralLeadingDot: false`, which
does apply there. Nothing outside granted folders is readable. A remembered `lastFolder` with no grant (e.g. after upgrading) opens to the empty state.
Commands used: read, write, read-dir, mkdir, rename, exists, watch, unwatch, stat.
**CSP:** local-only — `'self'`, IPC, `asset:` images, inline styles (CodeMirror/Mermaid/KaTeX). No network origins.

## 5. Behavior

### 5.1 Watcher → UI data flow
1. `fsx.watch(root, cb, { recursive: true, delayMs: 150 })`.
2. Events are filtered: ignore paths under `.git` and `node_modules` (other dot-folders like `.scratch` are shown); keep `.md` files and directories.
3. `tree.applyEvents` updates the sidebar (create/remove; rename arrives as remove+create).
4. If the open file is affected, `doc.onDiskChanged()` reads it:
   - content == `diskText` → ignore (our own save echo / no-op touch).
   - buffer clean → `editor.applyExternal(text)`, `diskText = text`.
   - buffer dirty → banner `changed`.
   - file missing → banner `deleted`.

### 5.2 `applyExternal(text)`
- `diffRange(old, new)` = common prefix + common suffix → one `{from, to, insert}` change.
- Dispatched with `Transaction.addToHistory.of(false)`: Cmd+Z only undoes the user's own edits; CM6 maps history and cursor through the change.
- **Tail-follow:** if the viewport was at the bottom before the change, scroll to bottom after. Otherwise scroll position is untouched.
- `ponytail:` single-range diff; two distant edits in one write replace everything between them (cursor inside that region snaps to the edge). Upgrade to a Myers diff lib if it bites.

### 5.3 Conflict banner
| State | Message | Actions |
|---|---|---|
| `changed` | File changed on disk. | **Reload** (discard mine, load disk) · **Save mine as copy** (write `name.conflict-YYYYMMDD-HHmmss.md` beside it, then reload) · **Keep mine** (dismiss; next save overwrites disk) |
| `deleted` | File deleted on disk. | **Save to recreate** · **Close** |
| `error` | Couldn't save: `<reason>` | **Dismiss** (buffer stays dirty) |

- While the banner is up, further disk events do not stack; actions act on the disk state at click time.

### 5.4 Saving
1. Re-read disk. If it differs from `diskText` (and the user hasn't chosen Keep mine) → banner `changed`, don't write.
2. Write buffer text verbatim. Set `diskText = text`, clear dirty.
3. On write failure → banner `error`, stay dirty.

### 5.5 Switching files / quitting with unsaved edits
In-app dialog (shadcn AlertDialog): **Save / Discard / Cancel**. Applies to tree clicks, file ops that remove the open file, and window close (`onCloseRequested`).

### 5.6 File ops (sidebar right-click, shadcn ContextMenu)
- New file → `untitled.md` (or `untitled-2.md`, …), opened, inline rename.
- New folder → `New Folder/untitled.md` (empty folders are hidden, so it gets a file), folder name in inline rename.
- Rename (inline input), Delete (in-app confirm dialog → `move_to_trash`).
- Name collision → inline error, nothing overwritten. New names without `.md` get `.md` appended.
- Renaming/deleting the open file updates/closes the editor (dirty → 5.5 dialog first).

### 5.7 Encoding & line endings
- Read as UTF-8 (`TextDecoder` with `fatal: true, ignoreBOM: true`). Decode failure → open read-only (lossy text) with a notice.
- On load: strip BOM and normalize to LF for the editor, remembering `{ eol, bom }` (eol = majority of CRLF vs LF).
  On save: re-apply them. Pure LF / pure CRLF / BOM files round-trip byte-for-byte; mixed endings normalize to the majority.

### 5.8 Settings
`settings.json` in the app config dir: `{ lastFolder, lastFile, recentFolders, recentFiles }`. Last folder/file restored on launch if they still exist. The appearance mode is not here: it lives in localStorage (`theme`) so `public/theme-init.js` can apply it before first paint.
`recentFolders`: up to 5 paths; `recentFiles`: up to 8 `{ path, root }`; newest first, deduped. Shown on the welcome screen;
entries that no longer exist or lost their grant are hidden; × removes one.

### 5.9 Errors
- Watcher fails → sidebar shows "Not watching" + Retry.
- Unreadable file → read-only notice.
- Save failure → `error` banner (5.3).

## 6. Cross-platform insurance (free now)
- Paths built only through `joinPath`/`parentOf`/`baseName` in `tree.ts` (one place to switch separators for Windows).
- Shortcuts check `metaKey || ctrlKey` (Cmd on Mac, Ctrl elsewhere).
- Line endings preserved (5.7).

## 7. Testing

**Unit (Vitest), pure modules, no Tauri:**
- `diffRange`: append, middle edit, delete, empty↔text, identical, CRLF boundary, emoji/surrogate pair boundary.
- `doc.ts` with a fake `fsx`: echo ignored; clean → reload; dirty → `changed`; each banner action; disk changed before save → no write; deleted → `deleted`; save failure → `error` + still dirty; CRLF round-trip.
- `buildTree` / `applyEvents`: .md-only, ignored dirs, empty folders hidden, create/remove/rename.

**Manual end-to-end** (Tauri WebDriver doesn't support macOS): `node scripts/fake-agent.mjs <folder>`, then:
1. Streamed append: no flicker, text appears live.
2. Scrolled to bottom: view follows. Scrolled up: view stays.
3. Cursor mid-document while agent appends: cursor stays.
4. Cmd+Z after agent writes only undoes my typing.
5. Edit + agent write → banner; each of the three actions behaves as specified.
6. Save after open/edit one line → `git diff` shows one line.
7. Agent creates/deletes files → tree updates; non-.md files never shown.
8. Agent deletes the open file → `deleted` banner.
9. Tables, image, Mermaid, math render; cursor in block shows source.
10. Quit with unsaved edits → Save/Discard/Cancel.

## 8. Prerequisites
- Rust ≥ 1.77.2 (`rustup`), Node 20+, Xcode Command Line Tools. See README.
