export type HeadingItem = {
  level: number;
  text: string;
  slug: string;
  from: number;
  line: number;
};

/** Strips common inline markdown syntax from a heading title for display & slugging. */
export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .trim();
}

/** GitHub-compatible heading slug. */
export function slugifyHeading(text: string): string {
  return cleanHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Extracts ATX (`#`..`######`) and Setext (`===` / `---`) headings from markdown text,
 * ignoring headings inside fenced code blocks.
 */
export function extractHeadings(markdown: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const slugCounts = new Map<string, number>();
  const lines = markdown.split("\n");

  let inFence: { char: string; len: number } | null = null;
  let offset = 0;

  const nextSlug = (text: string): string => {
    const base = slugifyHeading(text) || "section";
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineFrom = offset;
    offset += rawLine.length + 1;

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = { char: marker[0], len: marker.length };
        continue;
      } else if (marker[0] === inFence.char && marker.length >= inFence.len && line.slice(fenceMatch[0].length).trim() === "") {
        inFence = null;
        continue;
      }
    }
    if (inFence) continue;

    // ATX heading: up to 3 leading spaces, 1-6 '#', followed by space/tab or end of line
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/.exec(line);
    if (atx) {
      const level = atx[1].length;
      const cleaned = cleanHeadingText(atx[2] ?? "");
      if (cleaned) {
        headings.push({
          level,
          text: cleaned,
          slug: nextSlug(cleaned),
          from: lineFrom,
          line: i + 1,
        });
      }
      continue;
    }

    // Setext heading: next line is `===+` or `---+` and current line is non-empty paragraph text
    if (i + 1 < lines.length && line.trim() !== "" && !/^ {0,3}(?:[-*+]|\d+[.)]|>)/.test(line)) {
      const nextRaw = lines[i + 1];
      const nextLine = nextRaw.endsWith("\r") ? nextRaw.slice(0, -1) : nextRaw;
      const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(nextLine);
      if (setext) {
        const level = setext[1][0] === "=" ? 1 : 2;
        const cleaned = cleanHeadingText(line);
        if (cleaned) {
          headings.push({
            level,
            text: cleaned,
            slug: nextSlug(cleaned),
            from: lineFrom,
            line: i + 1,
          });
          offset += nextRaw.length + 1;
          i++;
        }
      }
    }
  }

  return headings;
}
