/// <reference types="node" />
// Integration stand-in for fsx: real files under a temp root, scripted folder picker, in-memory settings.
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeUtf8 } from "@/core/text";
import type * as Real from "@/platform/fsx";

type Answers = { pickFolder: (string | null)[] };

export function createNodeFsx() {
  const answers: Answers = { pickFolder: [] };
  const watchers = new Set<FSWatcher>();
  const titles: string[] = [];
  const windowThemes: Real.WindowTheme[] = [];
  const events: string[] = [];
  let settings: Real.Settings = {};
  let closeGuard: (() => Promise<boolean>) | null = null;
  // hold: a folder read awaits it first, so a test can keep a folder "still loading" (or make it fail).
  const ctl = { failWatch: false, hold: null as ((dir: string) => Promise<void>) | null };

  // An unscripted prompt fails the test instead of hanging it.
  function next<K extends keyof Answers>(k: K): Answers[K][number] {
    if (!answers[k].length) throw new Error(`Unscripted prompt: ${k}`);
    return answers[k].shift()!;
  }

  const fsx = {
    async readText(path: string) {
      try {
        return decodeUtf8(await readFile(path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" as const };
        throw e;
      }
    },
    writeText: (path: string, raw: string) => writeFile(path, raw),
    list: async (dir: string) => {
      await ctl.hold?.(dir);
      return (await readdir(dir, { withFileTypes: true })).map((d) => ({
        name: d.name,
        isDirectory: d.isDirectory(),
        isFile: d.isFile(),
        isSymlink: d.isSymbolicLink(),
      }));
    },
    async stat(path: string) {
      try {
        const s = await fsStat(path);
        return { isFile: s.isFile(), isDirectory: s.isDirectory() };
      } catch {
        return null;
      }
    },
    makeDir: (path: string) => mkdir(path),
    move: (from: string, to: string) => rename(from, to),
    pathExists: async (path: string): Promise<boolean> => (await fsx.stat(path)) !== null,
    trash: (path: string) => rm(path, { recursive: true }),
    grantHidden: async (_root: string) => {},
    assetUrl: (dir: string) => `file://${dir}`,
    async watchFolder(root: string, onPaths: (paths: string[]) => void) {
      if (ctl.failWatch) throw new Error("watch failed");
      const w = watch(root, { recursive: true }, (_e, f) => {
        if (!f) return;
        events.push(join(root, f));
        onPaths([join(root, f)]);
      });
      watchers.add(w);
      return () => { w.close(); watchers.delete(w); };
    },
    pickFolder: async () => next("pickFolder"),
    setTitle: async (t: string) => { titles.push(t); },
    setWindowTheme: async (t: Real.WindowTheme) => { windowThemes.push(t); },
    onCloseRequested(guard: () => Promise<boolean>) { closeGuard = guard; },
    loadSettings: async () => ({ ...settings }),
    saveSettings: async (s: Real.Settings) => { settings = { ...s }; },
  } satisfies typeof Real;

  return {
    fsx,
    answers,
    titles,
    windowThemes,
    events,
    ctl,
    get settings(): Real.Settings { return settings; },
    set settings(s: Real.Settings) { settings = s; },
    /** Simulates the window close button; resolves true if the app let the window close. */
    requestClose: () => closeGuard!(),
    dispose() { watchers.forEach((w) => w.close()); watchers.clear(); },
  };
}
