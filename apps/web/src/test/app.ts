/// <reference types="node" />
// Boots the real app (<App/>) in happy-dom against a temp folder, with fsx swapped for the Node stand-in.
import { mkdtemp, readFile, realpath, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { createNodeFsx } from "./fsx-node";
import type { Settings } from "@/platform/fsx";
import { THEME_KEY } from "@/platform/theme";
import { isMac } from "../lib/utils";

const nativeWindowAdd = window.addEventListener;
const nativeDocAdd = document.addEventListener;

const extra: string[] = [];

/** Another folder on disk, for recents across folders; removed with the next app's dispose(). */
export async function tempFolder(files: Record<string, string> = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "mdr-")));
  extra.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}

type Options = {
  files?: Record<string, string>;
  /** Last file to restore; the temp folder is always the last folder unless `settings` replaces both. */
  lastFile?: string;
  /** Replaces the default settings (temp folder as last folder); a function gets the temp folder path. */
  settings?: Settings | ((root: string) => Settings);
  failWatch?: boolean;
  /** OS appearance at boot; flip it later with `setOsDark`. */
  osDark?: boolean;
  /** Raw value already in localStorage under the theme key (left over from a previous run). */
  storedTheme?: string;
  /** Explicitly open the temp folder after boot (needed since app no longer auto-opens lastFolder on startup). */
  openFolder?: boolean;
};

export async function boot({ files = {}, lastFile, settings, failWatch = false, osDark = false, storedTheme, openFolder }: Options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mdr-")));
  const at = (rel: string) => join(root, rel);
  const write = async (rel: string, text: string) => {
    await mkdir(dirname(at(rel)), { recursive: true });
    await writeFile(at(rel), text);
  };
  for (const [rel, text] of Object.entries(files)) await write(rel, text);

  const stub = createNodeFsx();
  stub.ctl.failWatch = failWatch;
  stub.settings = typeof settings === "function" ? settings(root) : settings ?? { lastFolder: root, lastFile: lastFile && at(lastFile) };

  vi.restoreAllMocks();

  // The app and CodeMirror register window/document listeners; record them so dispose() can drop them.
  const added: [EventTarget, string, EventListenerOrEventListenerObject][] = [];
  window.addEventListener = function (type: any, fn: any, o: any) {
    added.push([window, type, fn]);
    return nativeWindowAdd.call(this, type, fn, o);
  };
  document.addEventListener = function (type: any, fn: any, o: any) {
    added.push([document, type, fn]);
    return nativeDocAdd.call(this, type, fn, o);
  };

  // OS appearance: a scriptable prefers-color-scheme query.
  const os = { dark: osDark, listeners: new Set<(e: { matches: boolean }) => void>() };
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    get matches() { return query.includes("dark") && os.dark; },
    media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => os.listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => os.listeners.delete(fn),
  }) as unknown as MediaQueryList);
  localStorage.clear();
  if (storedTheme !== undefined) localStorage.setItem(THEME_KEY, storedTheme);
  document.documentElement.className = "";

  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  vi.doMock("@/platform/fsx", () => stub.fsx);
  // Imported after the reset so App and the harness share one React instance.
  const [{ createElement }, { createRoot }, { default: App }] =
    await Promise.all([import("react"), import("react-dom/client"), import("@/App")]);
  // Records anything that ever flashed on screen, e.g. the welcome screen during startup restore.
  let welcomeEverShown = false;
  const seen = new MutationObserver(() => { welcomeEverShown ||= !!document.getElementById("welcome"); });
  seen.observe(document.body, { childList: true, subtree: true });
  const reactRoot = createRoot(document.getElementById("root")!);
  reactRoot.render(createElement(App));
  await vi.waitFor(() => { if (!stub.titles.length) throw new Error("app did not boot"); });

  const shouldOpen = openFolder ?? (
    settings
      ? (typeof settings === "function" ? settings(root) : settings).lastFolder === root
      : true
  );

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
  const view = () => EditorView.findFromDOM($(".cm-editor")!)!;
  const row = (rel: string) => $(`#tree .row[data-path="${CSS.escape(at(rel))}"]`);

  // Open the folder if requested (default: when no custom settings provided).
  if (shouldOpen) {
    stub.answers.pickFolder.push(root);
    const openBtn = document.querySelector<HTMLButtonElement>("[data-start] button")!;
    openBtn.click();
    await vi.waitFor(() => {
      if (Object.keys(files).length > 0) {
        if (!document.querySelector("#tree .row")) throw new Error("folder did not open");
      } else {
        if (stub.answers.pickFolder.length > 0) throw new Error("folder did not open");
      }
    });
    if (lastFile) {
      row(lastFile)!.click();
      await vi.waitFor(() => { if (!document.querySelector(".cm-editor")) throw new Error("file did not open"); });
    }
  }

  // FSEvents starts asynchronously: prove the watcher sees writes before the test makes any.
  if (shouldOpen && stub.events.length === 0 && !failWatch) {
    const probe = at(".watch-probe");
    await vi.waitFor(async () => {
      await writeFile(probe, String(Date.now()));
      if (!stub.events.includes(probe)) throw new Error("watcher not live");
    }, { timeout: 2000, interval: 20 });
    await rm(probe);
  }
  let disposed = false;

  return {
    root,
    at,
    stub,
    $,
    // What the user sees.
    rows: () => [...document.querySelectorAll<HTMLElement>("#tree .row")].map((r) => r.dataset.path!.slice(root.length + 1)),
    row,
    /** Absolute paths of the tree rows: for folders other than the boot folder. */
    paths: () => [...document.querySelectorAll<HTMLElement>("#tree .row")].map((r) => r.dataset.path!),
    /** The folder-loading overlay as the user (and assistive tech) sees it. */
    loading: () => ({
      overlay: $("#loading")?.querySelector("[role=status]")?.textContent ?? null,
      busy: $("#app")?.getAttribute("aria-busy") === "true",
    }),
    banner: () => $("#banner span")?.textContent ?? null,
    title: () => stub.titles.at(-1),
    text: () => view().state.doc.toString(),
    status: () => $("#status span")?.textContent ?? null,
    welcomeEverShown: () => welcomeEverShown,
    /** The editor's text as the user sees it: syntax marks the live preview hides (by CSS class) are left out. */
    shown() {
      const c = $(".cm-content")!.cloneNode(true) as HTMLElement;
      c.querySelectorAll(".cm-formatting-block:not(.cm-formatting-block-visible), .cm-formatting-inline:not(.cm-formatting-inline-visible)")
        .forEach((e) => e.remove());
      return c.textContent;
    },
    /** The view-mode button's label, or null when it isn't shown. */
    viewButton: () => $("#view-mode")?.getAttribute("aria-label") ?? null,
    appearance: () => ({
      label: $("#appearance")!.getAttribute("aria-label"),
      dark: document.documentElement.classList.contains("dark"),
    }),
    // What the user does.
    click: (rel: string) => row(rel)!.click(),
    toggleAppearance: () => $("#appearance")!.click(),
    clickViewMode: () => $("#view-mode")!.click(),
    undo: () => undo(view()),
    editable: () => !view().state.readOnly,
    /** ⌘E on macOS, Ctrl+E elsewhere; `other: true` presses the other modifier (Ctrl+E on macOS is CodeMirror's end-of-line). */
    pressViewKey: (other = false) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", [isMac !== other ? "metaKey" : "ctrlKey"]: true })),
    setOsDark(dark: boolean) { os.dark = dark; os.listeners.forEach((fn) => fn({ matches: dark })); },
    /** Right-clicks a row (or the tree's empty space) and picks an item from the in-app menu. */
    async contextMenu(rel: string | null, item: string) {
      const el = rel === null ? $("#tree")! : row(rel)!;
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      const find = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((i) => i.textContent === item);
      await until(() => { if (!find()) throw new Error(`no menu item "${item}"`); });
      find()!.click();
    },
    /** Answers the open in-app confirm dialog by its button label. */
    async choose(label: string) {
      const find = () => [...document.querySelectorAll<HTMLElement>("[role=alertdialog] button")].find((b) => b.textContent === label);
      await until(() => { if (!find()) throw new Error(`no dialog button "${label}"`); });
      find()!.click();
    },
    dialog: () => $("[role=alertdialog] h2")?.textContent ?? null,
    /** The welcome screen as the user sees it, or null when a file is open. */
    welcome: () => {
      const w = $("#welcome");
      if (!w) return null;
      const paths = (sel: string) => [...w.querySelectorAll<HTMLElement>(sel)].map((e) => e.dataset.path!);
      return {
        heading: w.querySelector("h1")!.textContent,
        actions: [...w.querySelectorAll<HTMLElement>("[data-start] button")].map((b) => b.textContent!.trim()),
        folders: paths("[data-recent-folder]"),
        files: paths("[data-recent-file]"),
      };
    },
    clickRecent: (path: string) => $<HTMLButtonElement>(`#welcome [data-path="${CSS.escape(path)}"] button.open`)!.click(),
    removeRecent: (path: string) => $<HTMLButtonElement>(`#welcome [data-path="${CSS.escape(path)}"] button.remove`)!.click(),

    button: (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent!.trim() === label)!.click(),
    type: (text: string) => view().dispatch({ changes: { from: view().state.doc.length, insert: text } }),
    save: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true })),
    async renameTo(name: string) {
      await until(() => { if (!$("#tree input.rename")) throw new Error("no rename input"); });
      const input = $<HTMLInputElement>("#tree input.rename")!;
      input.value = name;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    },
    // What an agent does from outside the app.
    write,
    read: (rel: string) => readFile(at(rel), "utf8"),
    remove: (rel: string) => rm(at(rel), { recursive: true }),
    async dispose() {
      if (disposed) return;
      disposed = true;
      stub.dispose();
      seen.disconnect();
      // ponytail: fixed settle so App's 20ms watcher batch drains before teardown; expose a drain hook if it flakes.
      await new Promise((r) => setTimeout(r, 30));
      const cmEl = $(".cm-editor");
      if (cmEl) EditorView.findFromDOM(cmEl)?.destroy();
      reactRoot.unmount();
      added.forEach(([t, type, fn]) => t.removeEventListener(type, fn));
      window.addEventListener = nativeWindowAdd;
      document.addEventListener = nativeDocAdd;
      vi.restoreAllMocks();
      await Promise.all([root, ...extra.splice(0)].map((d) => rm(d, { recursive: true, force: true })));
    },
  };
}

export type App = Awaited<ReturnType<typeof boot>>;

/** Polls until `fn` stops throwing: for anything driven by the file watcher. */
export const until = (fn: () => unknown) => vi.waitFor(fn, { timeout: 2000, interval: 10 });
