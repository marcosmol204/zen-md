import { describe, expect, test } from "vitest";
import { filterSlashCommands, matchSlashQuery, SLASH_COMMANDS } from "./slashMenu";

describe("slashMenu", () => {
  describe("matchSlashQuery", () => {
    test("matches slash at start of line", () => {
      expect(matchSlashQuery("/")).toEqual({ fromOffset: 0, query: "" });
      expect(matchSlashQuery("/h1")).toEqual({ fromOffset: 0, query: "h1" });
      expect(matchSlashQuery("/table")).toEqual({ fromOffset: 0, query: "table" });
    });

    test("matches slash after whitespace", () => {
      expect(matchSlashQuery("Hello /")).toEqual({ fromOffset: 6, query: "" });
      expect(matchSlashQuery("   /code")).toEqual({ fromOffset: 3, query: "code" });
      expect(matchSlashQuery("\t/list")).toEqual({ fromOffset: 1, query: "list" });
    });

    test("does not match slash within words or urls", () => {
      expect(matchSlashQuery("https://example.com/")).toBeNull();
      expect(matchSlashQuery("foo/bar")).toBeNull();
      expect(matchSlashQuery("and/or")).toBeNull();
    });

    test("does not match if there are spaces after slash", () => {
      expect(matchSlashQuery("/ ")).toBeNull();
      expect(matchSlashQuery("/h1 something")).toBeNull();
    });
  });

  describe("filterSlashCommands", () => {
    test("returns all commands on empty query", () => {
      const results = filterSlashCommands("");
      expect(results.length).toBe(SLASH_COMMANDS.length);
    });

    test("filters by heading id / label / keywords", () => {
      const h1 = filterSlashCommands("h1");
      expect(h1.map((c) => c.id)).toContain("h1");

      const head = filterSlashCommands("head");
      expect(head.map((c) => c.id)).toEqual(expect.arrayContaining(["h1", "h2", "h3"]));
    });

    test("filters by list keywords", () => {
      const list = filterSlashCommands("list");
      expect(list.map((c) => c.id)).toEqual(expect.arrayContaining(["bullet", "number", "task"]));
    });

    test("filters by code, table, mermaid, math", () => {
      expect(filterSlashCommands("code").map((c) => c.id)).toContain("code");
      expect(filterSlashCommands("tab").map((c) => c.id)).toContain("table");
      expect(filterSlashCommands("merm").map((c) => c.id)).toContain("mermaid");
      expect(filterSlashCommands("latex").map((c) => c.id)).toContain("math");
      expect(filterSlashCommands("todo").map((c) => c.id)).toContain("task");
      expect(filterSlashCommands("alert").map((c) => c.id)).toEqual(
        expect.arrayContaining(["note", "tip", "warning"]),
      );
    });
  });
});
