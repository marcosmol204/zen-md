import { describe, expect, test } from "vitest";
import { vetEdit, type Edit, type Lock } from "./lock";

// "# Head **bold** end\n|a|b|\n"
//  0 2    7 9   13 15  20
const heading: Lock = { from: 0, to: 2, kind: "prefix" };
const open: Lock = { from: 7, to: 9, kind: "inline", span: { from: 7, to: 15 }, content: { from: 9, to: 13 } };
const close: Lock = { from: 13, to: 15, kind: "inline", span: { from: 7, to: 15 }, content: { from: 9, to: 13 } };
const table: Lock = { from: 20, to: 26, kind: "block" };
const locks = [heading, open, close, table];
const ins = (at: number, insert: string): Edit => ({ from: at, to: at, insert });
const del = (from: number, to: number, dir?: -1 | 1): Edit => ({ from, to, insert: "", ...(dir ? { dir } : {}) });

describe("vetEdit", () => {
  test("text edits away from markup pass untouched", () => {
    expect(vetEdit(ins(4, "x"), locks)).toEqual(ins(4, "x"));
    expect(vetEdit(del(3, 5), locks)).toEqual(del(3, 5));
    expect(vetEdit(ins(11, "x"), locks)).toEqual(ins(11, "x")); // inside the bold text
  });

  test("edits that reach into hidden markup are refused", () => {
    expect(vetEdit(ins(1, "x"), locks)).toBeNull();
    expect(vetEdit(ins(8, "x"), locks)).toBeNull();
    expect(vetEdit(del(1, 4), locks)).toBeNull(); // Backspace into "# "
    expect(vetEdit(del(0, 2, -1), locks)).toBeNull(); // Backspace at the start of the heading text
    expect(vetEdit(del(5, 11), locks)).toBeNull(); // selection over the opening **
    expect(vetEdit(del(0, 20), locks)).toBeNull(); // select-all style delete
  });

  test("typing before a line's hidden prefix lands after it; a new line stays above", () => {
    expect(vetEdit(ins(0, "x"), locks)).toEqual(ins(2, "x"));
    expect(vetEdit(ins(0, "\n"), locks)).toEqual(ins(0, "\n"));
  });

  test("the line break before a prefix or around a block can't be removed", () => {
    const quote: Lock = { from: 5, to: 7, kind: "prefix" }; // "para\n> q"
    expect(vetEdit(del(4, 5, -1), [quote])).toBeNull();
    expect(vetEdit(del(19, 20), locks)).toBeNull(); // "\n" before the table
    expect(vetEdit(del(26, 27), locks)).toBeNull(); // "\n" after the table
  });

  test("blocks accept only new lines at their edges", () => {
    expect(vetEdit(ins(20, "x"), locks)).toBeNull();
    expect(vetEdit(ins(26, "x"), locks)).toBeNull();
    expect(vetEdit(ins(26, "\nmore"), locks)).toEqual(ins(26, "\nmore"));
    expect(vetEdit(ins(20, "above\n"), locks)).toEqual(ins(20, "above\n"));
  });

  test("deleting all of a span's visible text removes its marks too", () => {
    expect(vetEdit(del(9, 13), locks)).toEqual(del(7, 15));
    expect(vetEdit(del(9, 12), locks)).toEqual(del(9, 12)); // some text left: marks stay
    expect(vetEdit({ from: 9, to: 13, insert: "new" }, locks)).toEqual({ from: 9, to: 13, insert: "new" }); // retyping keeps bold
  });

  test("a selection holding the whole span (marks included) may go", () => {
    expect(vetEdit(del(6, 16), [open, close])).toEqual(del(6, 16));
  });

  test("Backspace/Delete beside a hidden inline mark deletes the visible character past it", () => {
    expect(vetEdit(del(13, 15, -1), locks)).toEqual(del(12, 13, -1)); // after "**bold**": removes "d"
    expect(vetEdit(del(7, 9, 1), locks)).toEqual(del(9, 10, 1)); // before "**bold**": removes "b"
  });
});
