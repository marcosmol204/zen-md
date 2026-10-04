// E2E stand-in for fsx (aliased in by `vite --mode e2e`): an in-memory folder at /w.
// Playwright seeds it via window.__seed before load and plays the agent via window.__agent.
// ponytail: files only — moving/trashing a folder leaves its children behind; fix when an e2e test needs it.
import { decodeUtf8 } from "@/core/text";
import { baseName, parentOf } from "@/core/tree";
import type * as Real from "@/platform/fsx";
import type * as Self from "./fsx-memory";

type Seed = { files: Record<string, string>; lastFile?: string; settings?: Real.Settings };
type Agent = { write(path: string, text: string): void; remove(path: string): void };
declare global {
  interface Window { __seed?: Seed; __agent: Agent }
}

const ROOT = "/w";
const seed = window.__seed ?? { files: {} };
const files = new Map(Object.entries(seed.files).map(([rel, t]) => [`${ROOT}/${rel}`, t]));
const dirs = new Set<string>([ROOT]);
for (const p of files.keys()) for (let d = parentOf(p); d !== ROOT; d = parentOf(d)) dirs.add(d);
let settings: Real.Settings = seed.settings ?? { lastFolder: ROOT, lastFile: seed.lastFile && `${ROOT}/${seed.lastFile}` };
const listeners = new Set<(paths: string[]) => void>();
const emit = (p: string) => listeners.forEach((l) => l([p]));

window.__agent = {
  write(rel, text) { files.set(`${ROOT}/${rel}`, text); emit(`${ROOT}/${rel}`); },
  remove(rel) { files.delete(`${ROOT}/${rel}`); emit(`${ROOT}/${rel}`); },
};

export const stat = async (p: string) =>
  files.has(p) ? { isFile: true, isDirectory: false } : dirs.has(p) ? { isFile: false, isDirectory: true } : null;

export const readText = async (p: string) =>
  files.has(p) ? decodeUtf8(new TextEncoder().encode(files.get(p)!)) : { kind: "missing" as const };
export const writeText = async (p: string, raw: string) => { files.set(p, raw); };
export const list = async (dir: string) =>
  [...files.keys(), ...dirs]
    .filter((p) => p !== dir && parentOf(p) === dir)
    .map((p) => ({ name: baseName(p), isFile: files.has(p), isDirectory: dirs.has(p), isSymlink: false }));
export const makeDir = async (p: string) => { dirs.add(p); };
export const move = async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); };
export const pathExists = async (p: string) => (await stat(p)) !== null;
export const trash = async (p: string) => { files.delete(p); dirs.delete(p); };
export const grantHidden = async (_root: string) => {};
export const assetUrl = (dir: string) => dir;
export const watchFolder = async (_root: string, onPaths: (paths: string[]) => void) => {
  listeners.add(onPaths);
  return () => { listeners.delete(onPaths); };
};
export const pickFolder = async () => ROOT;
export const setTitle = async (t: string) => { document.title = t; };
export const setWindowTheme = async (_t: import("@/platform/fsx").WindowTheme) => {};
export const onCloseRequested = (_guard: () => Promise<boolean>) => {};
export const loadSettings = async () => ({ ...settings });
export const saveSettings = async (s: Real.Settings) => { settings = { ...s }; };

// Fails to compile if this stand-in drifts from the real fsx surface.
export const _matchesReal = (f: typeof Self): typeof Real => f;
