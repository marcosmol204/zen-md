# zen-md — System Design & Architecture

Status: Implemented (v1)

---

## 1. Purpose & Vision

zen-md is a minimal, calm desktop Markdown workspace built for developers who collaborate with AI agents (Claude Code, Codex, Aider, etc.) while agents write to disk.

### Core Goals
- **Zero-flicker streaming**: When an agent streams hundreds of lines into an open file, the document updates smoothly without cursor jumps or screen flicker. If the user is scrolled to the bottom, the view tails the stream.
- **Zero clobbered edits**: If an agent modifies a file while the user has unsaved edits in zen-md, the user's buffer is never overwritten. A conflict banner offers clear resolution options.
- **File fidelity**: Local files are the source of truth. Saved files preserve exact bytes, encoding, and line endings (LF/CRLF) so git diffs remain minimal and clean.
- **Focus over bloat**: The editor focuses purely on reading and editing Markdown. Features like MCP servers or agent orchestration are intentionally omitted; any future extensions belong in a plugin system.

---

## 2. Architecture & Directory Structure

zen-md is structured as a Turbo monorepo separating native host capabilities from the web frontend:

- **`apps/desktop/`**: Tauri v2 desktop application. Houses the native host configuration, window management, permissions/scopes, file watcher bindings, and OS-specific integrations (such as moving files to trash).
- **`apps/web/`**: The frontend editor application.
  - **`src/core/`**: Pure, framework-agnostic logic. Handles document state transitions, file-tree traversal, watcher event reconciliation, text diffing, and line-ending (LF/CRLF) preservation. Zero DOM or platform dependencies.
  - **`src/editor/`**: CodeMirror 6 editor engine, live-preview Markdown extensions, math/Mermaid widgets, and external update application.
  - **`src/platform/`**: Platform abstraction layer. The single seam isolating all Tauri API calls.
  - **`src/components/`**: React view layer built with shadcn/ui, Radix primitives, and Tailwind CSS v4.
- **`scripts/`**: Development and testing utilities, including the simulated agent script for testing streaming writes and rapid file operations.

---

## 3. Key Architectural Boundaries

### 3.1 The Platform Seam (`platform/fsx.ts`)
`platform/fsx.ts` is the single module permitted to import Tauri APIs (`@tauri-apps/api`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`). No other module in `apps/web` may import Tauri packages directly. Swapping Tauri for another runtime (such as Electron or a web mock) requires modifying only this file.

### 3.2 Pure Core Logic (`core/`)
All file-tree generation, diffing, encoding/EOL handling, and document state transitions reside in `core/`. These modules are pure TypeScript with zero DOM or Tauri dependencies, enabling 100% unit test coverage via Vitest without mocks.

### 3.3 Minimal Rust Footprint
Rust code in `apps/desktop/src-tauri` is strictly limited to Tauri plugin setup and one native OS integration (`move_to_trash` via the `trash` crate). Any proposal to add custom Rust logic must be justified against keeping the codebase simple and maintainable in TypeScript.

---

## 4. System Behaviors

### 4.1 Watcher and External Updates
1. `fsx.watch(root, cb, { recursive: true, delayMs: 150 })` monitors the active folder.
2. Events are filtered to ignore `.git` and `node_modules` while keeping `.md` files and directories.
3. When the open document changes on disk, `doc.onDiskChanged()` evaluates the buffer:
   - **Content equals diskText**: Ignore (the event is an echo of our own save).
   - **Buffer is clean**: Call `editor.applyExternal(text)` and update `diskText = text`.
   - **Buffer is dirty**: Display the `changed` conflict banner.
   - **File is missing**: Display the `deleted` banner.

### 4.2 `applyExternal(text)` & Diff Application
- Changes are computed using `diffRange(oldText, newText)` to locate the common prefix and suffix, producing a single `{ from, to, insert }` transaction.
- Dispatched with `Transaction.addToHistory.of(false)`. This ensures that pressing `⌘Z` only undoes user keystrokes, never agent writes.
- **Tail-follow behavior**: If the viewport was at the bottom before the write, the editor smoothly scrolls to the new bottom. If the user was reading earlier in the document, the scroll position is preserved.

### 4.3 Conflict Resolution Banner
When a file changes on disk while the buffer has unsaved edits, the banner presents three actions:
- **Reload**: Discards local edits and loads the version from disk.
- **Save mine as copy**: Writes the local edits to `name.conflict-YYYYMMDD-HHmmss.md` alongside the original, then reloads disk content.
- **Keep mine**: Dismisses the banner. The next manual save will overwrite the disk version.

### 4.4 Save Strategy
- **Manual Save (`⌘S`)**: There is no autosave. Autosave in an agent-driven workspace leads to race conditions where half-written agent files are clobbered.
- Before writing, disk content is checked against `diskText`. If it changed unexpectedly (and the user did not choose "Keep mine"), the write halts and the conflict banner appears.
- Files are saved with original line endings (LF vs. CRLF) and BOM preserved.

### 4.5 Security & Permissions
- Folder-scoped permissions: Only folders explicitly opened by the user are granted access via `tauri-plugin-dialog` and `tauri-plugin-persisted-scope`.
- Strict Content Security Policy (CSP): Local-only (`'self'`, IPC, `asset:` protocol, inline styles for KaTeX/CodeMirror). No outbound network requests.

---

## 5. View Layer Decision Record (ADR 0001)

- **Framework**: React with shadcn/ui (Radix primitives) + Tailwind CSS v4 + Lucide icons.
- **Editor Host**: CodeMirror 6 mounted into a React ref. The editor view and document controller exist outside React re-renders to prevent layout thrashing during high-speed streaming.
- **Theme**: Light, Dark, and System modes. Preference is cached in `localStorage` so an inline script applies the `.dark` class before the first paint, eliminating theme flash.
