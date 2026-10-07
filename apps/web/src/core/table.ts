// GFM table rows, cell by cell, with positions: Preview edits one cell's text in place, so the rest
// of the table keeps its exact bytes (padding, alignment row, line endings).

import type { Range } from "./lock";

/** The cells of one table row: `text` is the trimmed cell, `from`/`to` its offsets in the line. */
export function rowCells(line: string): (Range & { text: string })[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") pipes.push(i);
  }
  const bounds = [-1, ...pipes, line.length];
  const cells: (Range & { text: string })[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    let from = bounds[i] + 1;
    let to = bounds[i + 1];
    const edge = i === 0 || i === bounds.length - 2;
    if (edge && line.slice(from, to).trim() === "") continue; // outside the leading/trailing pipe
    while (from < to && /\s/.test(line[from])) from++;
    while (to > from && /\s/.test(line[to - 1])) to--;
    if (from === to) from = to = Math.min(bounds[i] + 2, bounds[i + 1]); // empty cell: type after "| "
    cells.push({ from, to, text: line.slice(from, to) });
  }
  return cells;
}

/** True for the `| --- | :-: |` row under the header. */
export const isDelimiterRow = (line: string) => {
  const cells = rowCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.text));
};

/** Cell text as it must be written: one line, with `|` escaped. */
export const escapeCell = (text: string) => text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

/** The visible text of a cell, when it has no markdown markup; null when it does (such cells stay read-only). */
export function plainCell(text: string): string | null {
  return /[\\*_~`[\]<>$!]/.test(text) ? null : text;
}
