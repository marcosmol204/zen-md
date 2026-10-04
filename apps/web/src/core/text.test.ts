import { describe, expect, test } from "vitest";
import { conflictCopyPath, decodeUtf8, diffRange, joinFormat, splitFormat, type Change } from "./text";

const apply = (a: string, c: Change | null) => (c ? a.slice(0, c.from) + c.insert + a.slice(c.to) : a);
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

describe("diffRange", () => {
  const cases: [string, string, string][] = [
    ["append", "hello", "hello world"],
    ["prepend", "world", "hello world"],
    ["middle edit", "a quick fox", "a slow fox"],
    ["delete", "abc\ndef\nghi", "abc\nghi"],
    ["empty to text", "", "# Title\n"],
    ["text to empty", "# Title\n", ""],
    ["repeated chars", "aaaa", "aaaaaa"],
    ["emoji change", "x😀y", "x😁y"],
    ["emoji insert", "ab", "a😀b"],
  ];
  test.each(cases)("%s reconstructs target", (_n, a, b) => {
    expect(apply(a, diffRange(a, b))).toBe(b);
  });
  test("identical returns null", () => expect(diffRange("same", "same")).toBeNull());
  test("append is a pure insert at the end", () =>
    expect(diffRange("hello", "hello world")).toEqual({ from: 5, to: 5, insert: " world" }));
  test("never splits a surrogate pair in the old text", () => {
    const c = diffRange("x😀y", "x😁y")!;
    expect(isHigh("x😀y".charCodeAt(c.from - 1))).toBe(false);
    expect(c).toEqual({ from: 1, to: 3, insert: "😁" });
  });
});

describe("splitFormat / joinFormat", () => {
  const roundTrips: [string, string][] = [
    ["LF", "a\nb\n"],
    ["CRLF", "a\r\nb\r\n"],
    ["BOM + CRLF", "﻿a\r\nb\r\n"],
    ["BOM + LF", "﻿# x\n"],
    ["no trailing newline", "a\nb"],
    ["empty", ""],
  ];
  test.each(roundTrips)("%s round-trips byte-for-byte", (_n, raw) => {
    const { text, format } = splitFormat(raw);
    expect(text.includes("\r")).toBe(false);
    expect(text.startsWith("﻿")).toBe(false);
    expect(joinFormat(text, format)).toBe(raw);
  });
  test("editing one line of a CRLF file changes only that line", () => {
    const raw = "one\r\ntwo\r\nthree\r\n";
    const { text, format } = splitFormat(raw);
    expect(joinFormat(text.replace("two", "TWO"), format)).toBe("one\r\nTWO\r\nthree\r\n");
  });
  test("mixed endings use the majority", () => {
    expect(splitFormat("a\r\nb\r\nc\n").format.eol).toBe("\r\n");
    expect(splitFormat("a\nb\nc\r\n").format.eol).toBe("\n");
  });
});

describe("decodeUtf8", () => {
  test("valid UTF-8 keeps BOM in the string", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect(decodeUtf8(bytes)).toEqual({ kind: "ok", text: "﻿hi" });
  });
  test("invalid UTF-8 returns lossy text", () => {
    const r = decodeUtf8(new Uint8Array([0x68, 0xff, 0x69]));
    expect(r.kind).toBe("invalid");
    expect(r.kind === "invalid" && r.text).toBe("h�i");
  });
});

describe("conflictCopyPath", () => {
  const now = new Date(2026, 9, 1, 15, 30, 5);
  test("inserts stamp before extension", () =>
    expect(conflictCopyPath("/a/notes.md", now)).toBe("/a/notes.conflict-20261001-153005.md"));
  test("dot in folder name is not treated as extension", () =>
    expect(conflictCopyPath("/a.b/README", now)).toBe("/a.b/README.conflict-20261001-153005.md"));
});
