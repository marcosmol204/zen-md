export type TreeNode = { name: string; path: string; children: TreeNode[] | null };
export type Entry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean };
export type Stat = { isFile: boolean; isDirectory: boolean } | null;
export type TreeIO = { stat(path: string): Promise<Stat>; readDir(path: string): Promise<Entry[]> };

// ponytail: "/" separators; switch to platform sep when porting to Windows.
export const joinPath = (dir: string, name: string) => `${dir}/${name}`;
export const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const isMd = (path: string) => /\.md$/i.test(path);

// ponytail: .git stays hidden — its object dirs and constant churn would flood the walk/watcher (see 2fc510b).
const IGNORED = new Set([".git", "node_modules"]);

export function isIgnored(path: string, root: string): boolean {
  if (path === root) return false;
  if (!path.startsWith(root + "/")) return true;
  return path
    .slice(root.length + 1)
    .split("/")
    .some((s) => IGNORED.has(s));
}

export async function walkMd(dir: string, root: string, readDir: TreeIO["readDir"]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (d: string) => {
    let entries: Entry[];
    try {
      entries = await readDir(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = joinPath(d, e.name);
      if (e.isSymlink || isIgnored(p, root)) continue;
      if (e.isDirectory) await visit(p);
      else if (e.isFile && isMd(p)) out.push(p);
    }
  };
  await visit(dir);
  return out;
}

export async function reconcile(files: Set<string>, root: string, paths: string[], io: TreeIO): Promise<boolean> {
  let changed = false;
  const add = (f: string) => {
    if (!files.has(f)) { files.add(f); changed = true; }
  };
  const dropUnder = (p: string, keep: Set<string> = new Set()) => {
    for (const f of [...files]) {
      if ((f === p || f.startsWith(p + "/")) && !keep.has(f)) { files.delete(f); changed = true; }
    }
  };
  for (const p of new Set(paths)) {
    if (isIgnored(p, root)) continue;
    const st = await io.stat(p);
    if (!st) dropUnder(p);
    else if (st.isFile) { if (isMd(p)) add(p); }
    else if (st.isDirectory) {
      const found = new Set(await walkMd(p, root, io.readDir));
      dropUnder(p, found);
      found.forEach(add);
    }
  }
  return changed;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => (a.children === null) === (b.children === null)
    ? byName.compare(a.name, b.name)
    : a.children === null ? 1 : -1);
  nodes.forEach((n) => n.children && sortTree(n.children));
}

export function buildTree(root: string, files: Iterable<string>): TreeNode[] {
  const top: TreeNode[] = [];
  for (const f of files) {
    const parts = f.slice(root.length + 1).split("/");
    let level = top;
    let path = root;
    parts.forEach((name, i) => {
      path = joinPath(path, name);
      if (i === parts.length - 1) { level.push({ name, path, children: null }); return; }
      let dir = level.find((n) => n.children && n.name === name);
      if (!dir) { dir = { name, path, children: [] }; level.push(dir); }
      level = dir.children!;
    });
  }
  sortTree(top);
  return top;
}

export function uniqueName(base: string, ext: string, taken: Set<string>): string {
  if (!taken.has(base + ext)) return base + ext;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}${ext}`)) return `${base}-${i}${ext}`;
}

export const withMdExt = (name: string) => (isMd(name) ? name : `${name}.md`);

export function validName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Name can't be empty";
  if (n.includes("/")) return "Name can't contain /";
  if (n === "." || n === ".." || n.includes("\0")) return "Invalid name";
  return null;
}
