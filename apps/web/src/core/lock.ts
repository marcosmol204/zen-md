// Preview mode edits text, never markup. The editor hides markup behind "locks"; these rules decide
// whether a user edit may go through, and nudge the harmless ones to where the user meant them.

export type Range = { from: number; to: number };

/**
 * A hidden stretch of markup.
 * - `inline`: emphasis/code/link marks inside a line. `span` is the whole formatted node and `content`
 *   the visible text between its marks: deleting all of that text takes the marks with it.
 * - `prefix`: what starts a line (`# `, `> `, `- [ ] `, list indentation). Typing at its start lands after it.
 * - `block`: a whole rendered block (table, diagram, math, rule, code fence). Only new lines may touch its edges.
 */
export type Lock = Range & { kind: "inline" | "prefix" | "block"; span?: Range; content?: Range };

/** One change of a transaction, in pre-change positions. `dir` is the direction of a Backspace (-1) or Delete (1). */
export type Edit = Range & { insert: string; dir?: -1 | 1 };

/** The edit to apply instead (possibly moved or widened), or null when it would change markup. */
export function vetEdit(edit: Edit, locks: readonly Lock[]): Edit | null {
  let { from, to, insert } = edit;
  const bySize = [...locks].sort((a, b) => size(a.span ?? a) - size(b.span ?? b));

  // Deleting every visible character of a formatted span deletes the span, so no orphan marks show up.
  if (!insert && to > from) {
    for (const l of bySize) {
      if (l.span && l.content && from >= l.span.from && to <= l.span.to && from <= l.content.from && to >= l.content.to) {
        from = l.span.from;
        to = l.span.to;
      }
    }
  }

  // Backspace/Delete next to a hidden inline mark: the mark is skipped as one unit, so the user meant
  // the visible character beyond it (deleting the "d" of **bold** from after the closing **).
  if (edit.dir && !insert && from < to) {
    const mark = locks.find((l) => l.kind === "inline" && l.from === from && l.to === to);
    if (mark) {
      const next = edit.dir < 0 ? { from: from - 1, to: from } : { from: to, to: to + 1 };
      if (next.from < 0) return null;
      return vetEdit({ ...next, insert: "", dir: edit.dir }, locks);
    }
  }

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const l of locks) {
      if (l.span && from <= l.span.from && to >= l.span.to) continue; // the whole span goes: fine
      if (from === to) {
        if (from > l.from && from < l.to) return null;
        if (l.kind === "prefix" && from === l.from && from !== l.to && !insert.endsWith("\n")) {
          from = to = l.to; // typed before a heading's hidden "# ": it belongs to the heading text
          moved = true;
          break;
        }
        if (l.kind === "block" && from === l.from && !insert.endsWith("\n")) return null;
        if (l.kind === "block" && from === l.to && !insert.startsWith("\n")) return null;
        continue;
      }
      if (from < l.to && to > l.from) return null;
      // Removing the line break before a prefix or block would glue the line above into its markup.
      if (l.kind !== "inline" && to === l.from) return null;
      // Removing the line break after a block would glue the next line into it.
      if (l.kind === "block" && from === l.to) return null;
    }
    if (!moved) return { from, to, insert, ...(edit.dir ? { dir: edit.dir } : {}) };
  }
  return null;
}

const size = (r: Range) => r.to - r.from;
