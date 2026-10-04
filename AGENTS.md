# AGENTS.md — Guidelines for AI Coding Agents

Welcome to **zen-md**. This document outlines the project philosophy, key architectural boundaries, and strict invariants that all AI agents must follow when modifying this codebase.

---

## 1. Project Philosophy & Scope

zen-md is a dedicated, calm desktop Markdown workspace designed for developers collaborating with AI agents that write to disk.

### Strict Scope Invariants
- **Do not add AI agent orchestration, chat panels, or MCP servers to the core app.**
  zen-md is not an all-in-one AI platform. Its job is to read and edit Markdown files with live preview, rock-solid watcher behavior, and zero clobbered edits.
- **Extensibility belongs in plugins.**
  Any feature that adds non-editor functionality (such as integrations or custom tooling) must be planned for a future plugin system, never hardcoded into the core editor.
- **No autosave.**
  Autosave is intentionally omitted to prevent race conditions that overwrite files while an agent is streaming to disk. Saving is strictly manual (`⌘S`) or triggered by explicit user confirmation.

---

## 2. Hard Architectural Rules

When contributing or refactoring code, you must strictly uphold these architectural boundaries:

### Rule 1: The Platform Seam (`apps/web/src/platform/fsx.ts`)
- `apps/web/src/platform/fsx.ts` is the **only** file in the frontend allowed to import Tauri APIs (`@tauri-apps/api`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`).
- Never import `@tauri-apps/*` packages directly in React components, controllers, or core modules.
- If you need a new platform capability, add it as a function in `fsx.ts` and call it from `controller.ts`.

### Rule 2: Pure Core Modules (`apps/web/src/core/`)
- All logic in `apps/web/src/core/` (`text.ts`, `tree.ts`, `doc.ts`, `recents.ts`) must remain pure TypeScript.
- Never introduce dependencies on the DOM, `window`, `document`, React, or Tauri into `core/`.
- Every core module must have a corresponding `*.test.ts` file that executes under Vitest without DOM or platform mocks.

### Rule 3: Minimal Rust Footprint (`apps/desktop/src-tauri/`)
- Rust code is strictly restricted to plugin registration and native OS capabilities that have no Tauri plugin equivalent (specifically `move_to_trash`).
- Do not move application business logic, file parsing, or state management into Rust.

### Rule 4: Safe External Updates (`editor.applyExternal`)
- When disk changes arrive, external updates are applied via `diffRange()` and dispatched with `Transaction.addToHistory.of(false)`.
- Never wipe out the CodeMirror state or transaction history during external updates; user undo history (`⌘Z`) must only undo user keystrokes.

### Rule 5: File Fidelity
- Preserve byte accuracy and original line endings (LF vs. CRLF). Never unilaterally normalize line endings on disk.

---

## 3. Tech Stack

- **Monorepo**: Turborepo, npm workspaces (`apps/web`, `apps/desktop`)
- **Desktop Host**: Tauri v2, Rust 1.77.2+
- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS v4, Lucide React
- **UI Components**: shadcn/ui built on Radix UI primitives (`apps/web/src/components/ui/`)
- **Editor**: CodeMirror 6 with live-preview extensions, KaTeX (math), and lazy-loaded Mermaid
- **Testing**: Vitest (`apps/web/src/core/*.test.ts`, `apps/web/src/test/app.test.ts`)

---

## 4. Development & Verification Workflow

Always verify your changes before completing a task.

### Key Commands

```sh
# Run all unit tests
npm test

# Run TypeScript typechecks across all workspaces
npm run check-types

# Run linting and formatting checks
npm run check

# Start the web frontend in development mode
npm run dev

# Launch the desktop app with hot reload
npm run tauri dev
```

### Simulating External Agent Writes

To test watcher responsiveness, cursor stability, and conflict handling, use the provided simulation script:

```sh
# Simulate an agent streaming text into an open file
node scripts/fake-agent.mjs <target-folder-path> stream

# Simulate full file rewrites
node scripts/fake-agent.mjs <target-folder-path> rewrite

# Simulate rapid file creation and deletion
node scripts/fake-agent.mjs <target-folder-path> files
```

---

## 5. Architectural Reference

For complete system design details, state machine definitions, and decision records, read [DESIGN.md](DESIGN.md).
