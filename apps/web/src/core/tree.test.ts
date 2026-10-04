import { describe, expect, test } from "vitest";
import {
  baseName, buildTree, isIgnored, isMd, joinPath, parentOf, reconcile, uniqueName, validName, walkMd, withMdExt,
  type Entry, type TreeIO,
} from "./tree";

const R = "/proj";

// Fake filesystem: files map path -> true; dirs derived; symlinks listed explicitly.
function fakeFs(paths: string[], symlinks: string[] = []): TreeIO {
  const all = new Set(paths);
  const dirs = new Set<string>([R]);
  for (const p of [...paths, ...symlinks]) {
    let d = parentOf(p);
    while (d.length >= R.length) { dirs.add(d); d = parentOf(d); }
  }
  return {
    async stat(p) {
      if (all.has(p)) return { isFile: true, isDirectory: false };
      if (dirs.has(p)) return { isFile: false, isDirectory: true };
      return null;
    },
    async readDir(d): Promise<Entry[]> {
      const names = new Map<string, Entry>();
      for (const p of [...all, ...dirs, ...symlinks]) {
        if (p === d || parentOf(p) !== d) continue;
        const name = baseName(p);
        names.set(name, {
          name,
          isFile: all.has(p),
          isDirectory: dirs.has(p) && !symlinks.includes(p),
          isSymlink: symlinks.includes(p),
        });
      }
      return [...names.values()];
    },
  };
}

describe("isMd / isIgnored / path helpers", () => {
  test("md extension, case-insensitive", () => {
    expect(isMd("/a/README.MD")).toBe(true);
    expect(isMd("/a/x.md")).toBe(true);
    expect(isMd("/a/x.markdown")).toBe(false);
    expect(isMd("/a/x.txt")).toBe(false);
  });
  test("ignores .git, node_modules, outside root; shows other dot paths", () => {
    expect(isIgnored("/proj/.git/x.md", R)).toBe(true);
    expect(isIgnored("/proj/a/node_modules/x.md", R)).toBe(true);
    expect(isIgnored("/proj/.hidden.md", R)).toBe(false);
    expect(isIgnored("/proj/.scratch/testing/grilling.md", R)).toBe(false);
    expect(isIgnored("/projector/x.md", R)).toBe(true);
    expect(isIgnored("/proj/docs/x.md", R)).toBe(false);
    expect(isIgnored("/proj", R)).toBe(false);
  });
  test("path helpers", () => {
    expect(joinPath("/a", "b.md")).toBe("/a/b.md");
    expect(parentOf("/a/b/c.md")).toBe("/a/b");
    expect(baseName("/a/b/c.md")).toBe("c.md");
  });
});

describe("walkMd", () => {
  test("finds md files, skips ignored dirs and non-md", async () => {
    const io = fakeFs(["/proj/a.md", "/proj/b.txt", "/proj/docs/c.md", "/proj/.git/d.md", "/proj/node_modules/e.md"]);
    expect((await walkMd(R, R, io.readDir)).sort()).toEqual(["/proj/a.md", "/proj/docs/c.md"]);
  });
  test("skips symlinks (no loops, no duplicates)", async () => {
    const io = fakeFs(["/proj/a.md"], ["/proj/loop"]);
    expect(await walkMd(R, R, io.readDir)).toEqual(["/proj/a.md"]);
  });
});

describe("reconcile", () => {
  test("adds created md file, ignores non-md", async () => {
    const files = new Set<string>();
    const io = fakeFs(["/proj/new.md", "/proj/new.txt"]);
    expect(await reconcile(files, R, ["/proj/new.md", "/proj/new.txt"], io)).toBe(true);
    expect([...files]).toEqual(["/proj/new.md"]);
  });
  test("removes deleted file and everything under a deleted dir", async () => {
    const files = new Set(["/proj/a.md", "/proj/d/b.md", "/proj/d/e/c.md", "/proj/dd.md"]);
    const io = fakeFs(["/proj/a.md", "/proj/dd.md"]);
    expect(await reconcile(files, R, ["/proj/d"], io)).toBe(true);
    expect([...files].sort()).toEqual(["/proj/a.md", "/proj/dd.md"]);
  });
  test("rename (remove + create) moves the entry", async () => {
    const files = new Set(["/proj/old.md"]);
    const io = fakeFs(["/proj/new.md"]);
    await reconcile(files, R, ["/proj/old.md", "/proj/new.md"], io);
    expect([...files]).toEqual(["/proj/new.md"]);
  });
  test("dir event rescans that dir", async () => {
    const files = new Set(["/proj/d/gone.md"]);
    const io = fakeFs(["/proj/d/x.md", "/proj/d/y/z.md"]);
    await reconcile(files, R, ["/proj/d"], io);
    expect([...files].sort()).toEqual(["/proj/d/x.md", "/proj/d/y/z.md"]);
  });
  test("modify of known file reports no change", async () => {
    const files = new Set(["/proj/a.md"]);
    expect(await reconcile(files, R, ["/proj/a.md"], fakeFs(["/proj/a.md"]))).toBe(false);
  });
  test("ignored paths are skipped", async () => {
    const files = new Set<string>();
    expect(await reconcile(files, R, ["/proj/.git/x.md"], fakeFs(["/proj/.git/x.md"]))).toBe(false);
  });
});

describe("buildTree", () => {
  test("nests, dirs first, natural order, only dirs that contain md", () => {
    const t = buildTree(R, ["/proj/b.md", "/proj/a10.md", "/proj/a2.md", "/proj/z/x.md"]);
    expect(t.map((n) => n.name)).toEqual(["z", "a2.md", "a10.md", "b.md"]);
    expect(t[0]).toEqual({ name: "z", path: "/proj/z", children: [{ name: "x.md", path: "/proj/z/x.md", children: null }] });
  });
});

describe("naming", () => {
  test("uniqueName", () => {
    expect(uniqueName("untitled", ".md", new Set())).toBe("untitled.md");
    expect(uniqueName("untitled", ".md", new Set(["untitled.md", "untitled-2.md"]))).toBe("untitled-3.md");
    expect(uniqueName("New Folder", "", new Set(["New Folder"]))).toBe("New Folder-2");
  });
  test("withMdExt", () => {
    expect(withMdExt("notes")).toBe("notes.md");
    expect(withMdExt("notes.MD")).toBe("notes.MD");
  });
  test("validName", () => {
    expect(validName("ok name")).toBeNull();
    expect(validName("  ")).toBe("Name can't be empty");
    expect(validName("a/b")).toBe("Name can't contain /");
    expect(validName("..")).toBe("Invalid name");
  });
});
