import { describe, expect, test } from "vitest";
import { filterFiles, fuzzyScore } from "./switcher";

describe("fuzzyScore", () => {
  test("returns null when query is longer than target or not a subsequence", () => {
    expect(fuzzyScore("abc", "abcd")).toBeNull();
    expect(fuzzyScore("readme.md", "xyz")).toBeNull();
  });

  test("ranks prefix and boundary substring matches above mid-word matches", () => {
    const prefix = fuzzyScore("design.md", "des")!;
    const boundary = fuzzyScore("system-design.md", "des")!;
    const middle = fuzzyScore("redesign.md", "des")!;
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(middle);
  });

  test("scores subsequence matches and rewards consecutive characters", () => {
    const consecutive = fuzzyScore("quick-switcher.md", "qsw")!;
    const scattered = fuzzyScore("quite-slow-walk.md", "qsw")!;
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

describe("filterFiles", () => {
  const root = "/workspace";
  const files = [
    "/workspace/README.md",
    "/workspace/DESIGN.md",
    "/workspace/docs/architecture.md",
    "/workspace/docs/api-guide.md",
    "/workspace/notes/daily.md",
  ];

  test("with empty query, lists recent files first then alphabetical by relative path", () => {
    const res = filterFiles(files, root, "", ["/workspace/notes/daily.md", "/workspace/DESIGN.md"]);
    expect(res.map((r) => r.rel)).toEqual([
      "notes/daily.md",
      "DESIGN.md",
      "docs/api-guide.md",
      "docs/architecture.md",
      "README.md",
    ]);
  });

  test("matches by filename and prioritizes filename match over directory match", () => {
    const all = [...files, "/workspace/design/notes.md"];
    const res = filterFiles(all, root, "design");
    expect(res[0].rel).toBe("DESIGN.md");
    expect(res[1].rel).toBe("design/notes.md");
  });

  test("supports fuzzy path queries across folder and file names", () => {
    const res = filterFiles(files, root, "darch");
    expect(res.map((r) => r.rel)).toEqual(["docs/architecture.md"]);
  });
});
