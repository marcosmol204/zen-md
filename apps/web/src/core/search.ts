export type Match = { from: number; to: number };

export type SearchOptions = {
  caseSensitive?: boolean;
};

function fold(code: number): number {
  if (code >= 65 && code <= 90) return code + 32;
  if (code < 128) return code;
  const low = String.fromCharCode(code).toLowerCase();
  return low.length === 1 ? low.charCodeAt(0) : code;
}

/**
 * Finds all non-overlapping occurrences of `query` in `text` using the
 * Boyer-Moore-Horspool (BMH) algorithm over UTF-16 code units.
 */
export function findMatches(text: string, query: string, opts: SearchOptions = {}): Match[] {
  const n = text.length;
  const m = query.length;
  if (m === 0 || n === 0 || m > n) return [];

  const caseSensitive = opts.caseSensitive ?? false;
  const out: Match[] = [];

  if (m === 1) {
    const target = caseSensitive ? query.charCodeAt(0) : fold(query.charCodeAt(0));
    for (let i = 0; i < n; i++) {
      const c = caseSensitive ? text.charCodeAt(i) : fold(text.charCodeAt(i));
      if (c === target) out.push({ from: i, to: i + 1 });
    }
    return out;
  }

  const pat = new Uint16Array(m);
  for (let i = 0; i < m; i++) {
    pat[i] = caseSensitive ? query.charCodeAt(i) : fold(query.charCodeAt(i));
  }

  const last = m - 1;
  const shift = new Int32Array(256).fill(m);
  for (let i = 0; i < last; i++) {
    shift[pat[i] & 0xff] = last - i;
  }

  const limit = n - m;
  let i = 0;
  while (i <= limit) {
    const lastCode = caseSensitive ? text.charCodeAt(i + last) : fold(text.charCodeAt(i + last));
    if (lastCode === pat[last]) {
      let j = last - 1;
      while (j >= 0) {
        const c = caseSensitive ? text.charCodeAt(i + j) : fold(text.charCodeAt(i + j));
        if (c !== pat[j]) break;
        j--;
      }
      if (j < 0) {
        out.push({ from: i, to: i + m });
        i += m;
        continue;
      }
    }
    i += shift[lastCode & 0xff];
  }

  return out;
}

/** Picks the first match at or after `cursorPos`, wrapping around to 0 when needed, or -1 if none. */
export function activeMatchIndex(matches: readonly Match[], cursorPos: number): number {
  if (matches.length === 0) return -1;
  const idx = matches.findIndex((m) => m.from >= cursorPos);
  return idx >= 0 ? idx : 0;
}

/** Steps the active match index forward (+1) or backward (-1) with wrap-around. */
export function stepMatchIndex(count: number, current: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  const base = current < 0 || current >= count ? 0 : current;
  return (base + delta + count) % count;
}
