import { defineConfig, type Plugin } from "vite";
import process from "node:process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// codemirror-live-markdown inlines lowlight, whose index evaluates all ~190 highlight.js grammars
// although the library registers only `common`. Dropping that call lets the bundler tree-shake ~1.5 MB.
const dropLowlightAll: Plugin = {
  name: "drop-lowlight-all",
  transform(code, id) {
    if (!id.includes("codemirror-live-markdown/dist/index.js")) return;
    const out = code.replace(/(var init_lowlight = __esm\(\{\s*"node_modules\/lowlight\/index\.js"\(\) \{\s*)init_all\(\);/, "$1");
    if (out === code) this.error("drop-lowlight-all: pattern not found; codemirror-live-markdown changed, re-check or remove this plugin");
    return out;
  },
};

// controller.ts imports the editor chunk on demand so the shell paints first. Preloading it from the HTML
// fetches it alongside the main chunk instead of after it: WebKit, editor ready 92 → 81 ms (eager import: 77).
const preloadEditor: Plugin = {
  name: "preload-editor",
  apply: "build",
  transformIndexHtml(_, ctx) {
    const chunk = Object.values(ctx.bundle ?? {}).find((c) => c.type === "chunk" && c.name === "editor");
    if (!chunk) throw new Error("preload-editor: no `editor` chunk; is @/editor/editor still imported dynamically?");
    return [{ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `/${chunk.fileName}` }, injectTo: "head" }];
  },
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), dropLowlightAll, preloadEditor],
  // Desktop app: chunks load from disk, not the network. The largest, mermaid's elk (~1.4 MB), loads only
  // for diagrams that use it; the editor is its own chunk (see preloadEditor).
  build: { chunkSizeWarningLimit: 1500 },
  resolve: {
    // `vite --mode e2e`: swap the Tauri fsx for the in-memory stand-in Playwright drives.
    // ponytail: matches the "@/platform/fsx" specifier only (controller.ts is the sole importer); widen if another module imports it.
    alias: [
      ...(mode === "e2e" ? [{ find: /^@\/platform\/fsx$/, replacement: "/src/test/fsx-memory.ts" }] : []),
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
