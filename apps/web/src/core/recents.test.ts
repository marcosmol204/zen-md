import { describe, expect, test } from "vitest";
import { move, remove, touch } from "./recents";

describe("touch", () => {
  test("puts the item first, newest first", () => {
    expect(touch(["/b", "/c"], "/a", 5)).toEqual(["/a", "/b", "/c"]);
  });

  test("moves an existing entry to the top without duplicating it", () => {
    expect(touch(["/a", "/b", "/c"], "/c", 5)).toEqual(["/c", "/a", "/b"]);
  });

  test("drops the oldest past the cap", () => {
    expect(touch(["/a", "/b", "/c"], "/d", 3)).toEqual(["/d", "/a", "/b"]);
  });

  test("dedupes file entries by path, keeping the new root", () => {
    const list = [{ path: "/r/a.md", root: "/r" }, { path: "/r/b.md", root: "/r" }];
    expect(touch(list, { path: "/r/b.md", root: "/r2" }, 8)).toEqual([
      { path: "/r/b.md", root: "/r2" },
      { path: "/r/a.md", root: "/r" },
    ]);
  });
});

describe("remove", () => {
  test("removes the entry with that path", () => {
    expect(remove(["/a", "/b"], "/a")).toEqual(["/b"]);
  });

  test("removes everything under a removed folder, not siblings sharing a prefix", () => {
    const list = [{ path: "/r/d/a.md", root: "/r" }, { path: "/r/d2/b.md", root: "/r" }];
    expect(remove(list, "/r/d")).toEqual([{ path: "/r/d2/b.md", root: "/r" }]);
  });
});

describe("move", () => {
  test("rewrites a renamed path and paths under a renamed folder", () => {
    const list = [{ path: "/r/d/a.md", root: "/r" }, { path: "/r/d.md", root: "/r" }, { path: "/r/x.md", root: "/r" }];
    expect(move(list, "/r/d", "/r/e")).toEqual([
      { path: "/r/e/a.md", root: "/r" },
      { path: "/r/d.md", root: "/r" },
      { path: "/r/x.md", root: "/r" },
    ]);
    expect(move(["/r/d", "/s"], "/r/d", "/r/e")).toEqual(["/r/e", "/s"]);
  });

  test("rewrites a file's root when its folder is renamed", () => {
    expect(move([{ path: "/r/d/a.md", root: "/r/d" }], "/r/d", "/r/e")).toEqual([{ path: "/r/e/a.md", root: "/r/e" }]);
  });
});
