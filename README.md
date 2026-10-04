# md-reader

Minimal Markdown editor for folders AI agents write into. Typora-like live preview, live reload without cursor jumps, and a banner instead of clobbering your unsaved edits.

macOS is the primary platform. Windows and Linux are unsupported (CI checks they compile) — [contributions welcome](CONTRIBUTING.md).

## Prerequisites

- [Node](https://nodejs.org) 22+ (or ≥ 20.19)
- [Rust](https://rustup.rs) ≥ 1.77.2 (after installing, ensure Cargo is in your `$PATH`: run `source "$HOME/.cargo/env"` or restart your terminal)
- Your platform's Tauri dependencies — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (on macOS: `xcode-select --install`)

Not sure what's missing? `npx tauri info` reports it.

> [!TIP]
> If Vite fails during build with `Cannot find native binding` (an npm optional dependencies issue), install the platform binding directly:  
> `npm i -D @rolldown/binding-darwin-arm64` (on macOS Apple Silicon) or your platform's equivalent.

## Run

```sh
git clone <repo-url> md-reader
cd md-reader
npm install
npm start
```

`npm start` makes a production build and launches it from the repo. Nothing is installed on your system; the first build takes a few minutes, later ones about a minute.

- macOS: the app is at `apps/desktop/src-tauri/target/release/bundle/macos/md-reader.app` — drag it to Applications if you like.
- Windows/Linux: the binary is in `apps/desktop/src-tauri/target/release/`.

**Update:** `git pull && npm install && npm start`.

## Develop

```sh
npm run tauri dev   # dev app with hot reload
npm test            # unit tests
```

Simulate an agent writing files: `node scripts/fake-agent.mjs <folder> [stream|rewrite|atomic|files|delete|all]`

Docs: [design](docs/design.md) · [ADRs](docs/adr/)

## License

[MIT](LICENSE)
