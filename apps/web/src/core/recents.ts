// Recent folders (paths) and recent files ({ path, root }), newest first.
export type RecentFile = { path: string; root: string };
type Entry = string | RecentFile;

const pathOf = (e: Entry) => (typeof e === "string" ? e : e.path);
const within = (p: string, base: string) => p === base || p.startsWith(base + "/");

/** `item` moves to the top (deduped by path); the list keeps at most `cap` entries. */
export function touch<T extends Entry>(list: T[], item: T, cap: number): T[] {
  return [item, ...list.filter((e) => pathOf(e) !== pathOf(item))].slice(0, cap);
}

/** Drops `path` and anything under it. */
export function remove<T extends Entry>(list: T[], path: string): T[] {
  return list.filter((e) => !within(pathOf(e), path));
}

/** Rewrites entries (and a file's root) at or under `from` after a rename to `to`. */
export function move<T extends Entry>(list: T[], from: string, to: string): T[] {
  const re = (p: string) => (within(p, from) ? to + p.slice(from.length) : p);
  return list.map((e) => (typeof e === "string" ? re(e) : { path: re(e.path), root: re(e.root) }) as T);
}
