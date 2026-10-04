# ADR 0001: React + shadcn/ui for the view layer

Date: 2026-10-02 · Status: accepted · Supersedes: design.md §2 "Stack: plain TypeScript (no UI framework)"

## Context

v1 builds the UI by hand with `document.createElement` (`sidebar.ts`, `banner.ts`) and one 51-line `styles.css`.
There are no shared components, icons, or tokens, and the empty state is a single line of text. The UI refresh
(`.scratch/ui-refresh/`) adds a welcome screen with recents, in-app context menu and dialogs, and a full restyle.
The app should also look right on Windows later, so native-macOS-only styling is out.

## Decision

- **React** owns the view layer only. The tested logic modules (`core/` doc, tree, text, recents; `platform/fsx.ts`;
  `editor/` editor, tasks, mermaid) keep their interfaces; CodeMirror is mounted into a React ref.
- **shadcn/ui** (components copied into `src/components/ui/`, built on Radix) + **Tailwind CSS v4** + **lucide-react**
  icons form the component system. Neutral base color, system font stack, light/dark follows the OS.
- The sidebar context menu and the Unsaved / Move-to-Trash confirms become shadcn `ContextMenu` / `AlertDialog`.
  The folder picker stays a native dialog (it is the folder trust grant).
- Native window title bar on every OS.

## Consequences

- New deps: `react`, `react-dom`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, Radix packages pulled
  in by shadcn, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`.
- `fsx.ts` loses `askUnsaved`, `confirmTrash`, `popupMenu` (no longer platform calls); still the only Tauri importer.
- `src/test/app.test.ts` keeps its behavior specs; the harness mounts React and clicks in-DOM dialogs/menus instead of
  stubbing native answers.
- The window-close guard now awaits an in-app dialog inside Tauri's `onCloseRequested` handler — must be checked in
  the running app, not only in tests.
