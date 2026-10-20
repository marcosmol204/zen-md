import { describe, expect, test } from "vitest";
import { activeMatchIndex, findMatches, stepMatchIndex } from "./search";

describe("findMatches", () => {
  test("returns empty for empty query, empty text, or query longer than text", () => {
    expect(findMatches("hello", "")).toEqual([]);
    expect(findMatches("", "a")).toEqual([]);
    expect(findMatches("hi", "hello")).toEqual([]);
  });

  test("finds single-character and multi-character matches", () => {
    expect(findMatches("ababa", "a")).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
      { from: 4, to: 5 },
    ]);
    expect(findMatches("the quick brown fox jumps over the lazy dog", "the")).toEqual([
      { from: 0, to: 3 },
      { from: 31, to: 34 },
    ]);
  });

  test("is case-insensitive by default and respects caseSensitive option", () => {
    const text = "Alpha alpha ALPHA aLpHa";
    expect(findMatches(text, "alpha")).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
      { from: 18, to: 23 },
    ]);
    expect(findMatches(text, "Alpha", { caseSensitive: true })).toEqual([{ from: 0, to: 5 }]);
    expect(findMatches(text, "ALPHA", { caseSensitive: true })).toEqual([{ from: 12, to: 17 }]);
  });

  test("returns non-overlapping matches on repeated patterns", () => {
    expect(findMatches("aaaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  test("handles unicode, special characters, and multi-line markdown", () => {
    const md = "# Café\n\nSome **café** and `CAFÉ`.\n";
    expect(findMatches(md, "café")).toEqual([
      { from: 2, to: 6 },
      { from: 15, to: 19 },
      { from: 27, to: 31 },
    ]);
    expect(findMatches(md, "CAFÉ", { caseSensitive: true })).toEqual([{ from: 27, to: 31 }]);
  });
});

describe("activeMatchIndex and stepMatchIndex", () => {
  const matches = [
    { from: 5, to: 8 },
    { from: 15, to: 18 },
    { from: 30, to: 33 },
  ];

  test("picks the first match at or after cursor, wrapping to 0 when past the end", () => {
    expect(activeMatchIndex([], 0)).toBe(-1);
    expect(activeMatchIndex(matches, 0)).toBe(0);
    expect(activeMatchIndex(matches, 5)).toBe(0);
    expect(activeMatchIndex(matches, 6)).toBe(1);
    expect(activeMatchIndex(matches, 31)).toBe(0);
  });

  test("steps forward and backward with wrap-around", () => {
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
    expect(stepMatchIndex(3, 0, 1)).toBe(1);
    expect(stepMatchIndex(3, 2, 1)).toBe(0);
    expect(stepMatchIndex(3, 0, -1)).toBe(2);
    expect(stepMatchIndex(3, 2, -1)).toBe(1);
  });
});
