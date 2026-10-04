# zen-md

A calm Markdown workspace built for developers who collaborate with AI agents.

Typora-style inline preview, rock-solid file watching without cursor jumps, and conflict protection so agents never clobber your edits.

---

## Why zen-md

Chatting with an AI agent inside an IDE always felt unnatural to me.

IDEs are built for writing syntax, compiling code, and debugging breakpoints. But collaborating with an agent on architecture, specifications, and task plans is a reading and thinking activity.

In an IDE, you usually get stuck in a cramped sidebar chat box or a split pane with raw markdown on one side and a laggy web preview on the other. Worse, when an agent like Claude Code or Codex streams a new plan into a file, the editor flickers, the scroll position jumps, and if you happen to tweak a sentence while the agent is running, the IDE frequently overwrites your work.

Other tools went in the opposite direction, packing in MCP integrations, chat panels, prompt managers, and complex agent orchestrators. I didn't want another heavyweight suite. I just wanted to edit Markdown files.

I wanted a separate, quiet window.

zen-md opens any folder of markdown files on your machine. You let your agent write, stream, and update files in the background. zen-md displays the formatted result instantly, keeps your view stable, and preserves every word you write.

## What it does

### Live inline preview
Headings, code blocks with syntax highlighting, tables, math with KaTeX, and Mermaid diagrams render directly in place. Markdown syntax stays hidden until your cursor enters that specific line.

### Stable streaming without cursor jumps
When an agent streams 500 lines of text into your active file, zen-md updates the content quietly without redrawing the whole buffer. Your cursor stays where you left it. If your view is scrolled to the bottom, zen-md follows the incoming text smoothly.

### Conflict protection
If you edit an open file while an agent writes to that same file on disk, zen-md never overwrites your buffer. A banner appears offering three straightforward choices: reload from disk, save your edits as a copy, or keep your version.

### Pure local files
Your local files remain the single source of truth. zen-md saves exact bytes and preserves your line endings (LF/CRLF) so git diffs stay clean.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 20.19+ or 22+
- [Rust](https://rustup.rs) 1.77.2+ (ensure `cargo` is in your `$PATH`)
- macOS: Xcode Command Line Tools (`xcode-select --install`)

If you are missing any build dependencies, run `npx tauri info` to inspect your environment.

### Run

```sh
git clone <repo-url> zen-md
cd zen-md
npm install
npm start
```

`npm start` builds a release binary and opens it. Nothing is installed globally.
On macOS, the built application is located at `apps/desktop/src-tauri/target/release/bundle/macos/zen-md.app`.

### Development

```sh
npm run tauri dev   # start frontend and Tauri dev window with hot reload
npm test            # run test suite
```

You can simulate an agent writing files using the included script:
```sh
node scripts/fake-agent.mjs <folder-path> stream
```

---

## Shortcuts

| Action | Shortcut |
|---|---|
| Toggle Formatted / Source view | `⌘E` |
| Save file | `⌘S` |
| Open folder | `⌘O` |

---

## Roadmap & Philosophy

The core of zen-md will always stay focused on this single job: reading and editing local Markdown files without distraction.

We will keep the base editor intentionally lean. No built-in MCP servers, no agent runtimes, and no feature bloat. If you need capabilities beyond reading and editing Markdown, those will be supported through a future plugin mechanism so the core app remains lightweight and quiet.

---

## Platform Support

zen-md is built primarily for macOS. Windows and Linux builds compile in CI, but are currently community-supported.

## License

[MIT](LICENSE)
