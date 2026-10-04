// The ONLY module that imports Tauri. Swap this file to port off Tauri.
import { exists, mkdir, readDir, readFile, rename, stat as fsStat, watchImmediate, writeFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appConfigDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { decodeUtf8, type ReadResult } from "@/core/text";
import { joinPath, type Entry, type Stat } from "@/core/tree";

export type Settings = {
  lastFolder?: string;
  lastFile?: string;
  recentFolders?: string[];
  recentFiles?: { path: string; root: string }[];
  /** Sidebar width in px, as the user last set it (unclamped to the current window). */
  sidebarWidth?: number;
};

export async function readText(path: string): Promise<ReadResult> {
  try {
    return decodeUtf8(await readFile(path));
  } catch (e) {
    if (!(await exists(path))) return { kind: "missing" };
    throw e;
  }
}

export const writeText = (path: string, raw: string) => writeFile(path, new TextEncoder().encode(raw));
export const list = (dir: string): Promise<Entry[]> => readDir(dir);

export async function stat(path: string): Promise<Stat> {
  try {
    const s = await fsStat(path);
    return { isFile: s.isFile, isDirectory: s.isDirectory };
  } catch {
    return null;
  }
}

export const makeDir = (path: string) => mkdir(path);
export const move = (from: string, to: string) => rename(from, to);
export const pathExists = (path: string) => exists(path);
export const trash = (path: string) => invoke<void>("move_to_trash", { path });
export const grantHidden = (root: string) => invoke<void>("grant_hidden", { root });
export const assetUrl = (dir: string) => convertFileSrc(dir);

// Not `watch`: its debouncer walks the whole tree (node_modules, symlinks) on the main thread
// before watching, which froze the app for 30s+ on a large repo. main.ts batches events itself.
export const watchFolder = (root: string, onPaths: (paths: string[]) => void) =>
  watchImmediate(root, (e) => onPaths(e.paths), { recursive: true });

export async function pickFolder(): Promise<string | null> {
  // Picking a folder is the trust grant: the dialog adds it (recursively) to the fs + asset scope.
  const r = await open({ directory: true, recursive: true });
  return typeof r === "string" ? r : null;
}

export const setTitle = (t: string) => getCurrentWindow().setTitle(t);
/** `null` hands the titlebar back to the OS appearance. */
export type WindowTheme = "light" | "dark" | null;
export const setWindowTheme = (t: WindowTheme) => getCurrentWindow().setTheme(t);

// Tauri awaits an async handler before closing, so the guard can show the in-app Unsaved dialog.
export function onCloseRequested(guard: () => Promise<boolean>) {
  void getCurrentWindow().onCloseRequested(async (e) => {
    if (!(await guard())) e.preventDefault();
  });
}

export async function loadSettings(): Promise<Settings> {
  try {
    const r = await readText(joinPath(await appConfigDir(), "settings.json"));
    return r.kind === "ok" ? JSON.parse(r.text) : {};
  } catch {
    return {};
  }
}

export async function saveSettings(s: Settings) {
  const dir = await appConfigDir();
  await mkdir(dir, { recursive: true });
  await writeText(joinPath(dir, "settings.json"), JSON.stringify(s));
}
