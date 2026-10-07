import { describe, expect, test } from "vitest";
import { escapeCell, isDelimiterRow, plainCell, rowCells } from "./table";

const texts = (line: string) => rowCells(line).map((c) => c.text);

describe("rowCells", () => {
  test("cells with and without outer pipes, trimmed, with positions", () => {
    expect(texts("| a | bb |")).toEqual(["a", "bb"]);
    expect(texts("a | bb")).toEqual(["a", "bb"]);
    const [a, b] = rowCells("|  a | bb  |");
    expect([a.from, a.to, b.from, b.to]).toEqual([3, 4, 7, 9]);
  });

  test("escaped pipes stay inside the cell", () => {
    expect(texts("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });

  test("an empty cell is an insertion point after its opening pipe and space", () => {
    const [, empty] = rowCells("| a |  | c |");
    expect(empty).toEqual({ from: 6, to: 6, text: "" });
    expect(rowCells("| a || c |")[1]).toEqual({ from: 5, to: 5, text: "" });
  });
});

test("isDelimiterRow", () => {
  expect(isDelimiterRow("| --- | :-: | --: |")).toBe(true);
  expect(isDelimiterRow("| a | b |")).toBe(false);
});

test("escapeCell keeps a cell on one line and its pipes literal", () => {
  expect(escapeCell(" a|b\nc ")).toBe("a\\|b c");
});

test("plainCell: only markup-free cells are editable as text", () => {
  expect(plainCell("hello world 42")).toBe("hello world 42");
  expect(plainCell("**bold**")).toBeNull();
  expect(plainCell("[link](x)")).toBeNull();
});
