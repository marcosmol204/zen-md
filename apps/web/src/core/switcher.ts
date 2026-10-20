import { baseName, relativePath } from "./tree";

export type SwitcherItem = {
  path: string;
  name: string;
  rel: string;
  score: number;
};

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isBoundary(str: string, idx: number): boolean {
  if (idx === 0) return true;
  const prev = str.charCodeAt(idx - 1);
  // '/', '-', '_', '.', ' '
  return prev === 47 || prev === 45 || prev === 95 || prev === 46 || prev === 32;
}

/**
 * Scores `query` (already lowercased) against `target` (lowercased).
 * Returns null if `query` is not a subsequence of `target`.
 */
export function fuzzyScore(target: string, query: string): number | null {
  const qLen = query.length;
  const tLen = target.length;
  if (qLen === 0) return 0;
  if (qLen > tLen) return null;

  const subIdx = target.indexOf(query);
  if (subIdx !== -1) {
    // Contiguous substring match gets a high base score.
    let bonus = 100 + qLen * 10;
    if (subIdx === 0) bonus += 50;
    else if (isBoundary(target, subIdx)) bonus += 30;
    return bonus - subIdx;
  }

  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2;

  for (let ti = 0; ti < tLen && qi < qLen; ti++) {
    if (target.charCodeAt(ti) === query.charCodeAt(qi)) {
      score += 10;
      if (ti === prevMatchIdx + 1) score += 15; // consecutive bonus
      if (isBoundary(target, ti)) score += 12; // boundary bonus
      prevMatchIdx = ti;
      qi++;
    }
  }

  return qi === qLen ? score - (tLen - qLen) : null;
}

/**
 * Filters and ranks workspace markdown files for the Quick File Switcher (`⌘P`).
 */
export function filterFiles(
  files: Iterable<string>,
  root: string,
  query: string,
  recentPaths: readonly string[] = [],
): SwitcherItem[] {
  const q = query.trim().toLowerCase();
  const recentRank = new Map<string, number>();
  recentPaths.forEach((p, idx) => {
    if (!recentRank.has(p)) recentRank.set(p, idx);
  });

  const items: SwitcherItem[] = [];
  for (const path of files) {
    const name = baseName(path);
    const rel = relativePath(path, root);
    if (!q) {
      const rank = recentRank.get(path);
      const score = rank !== undefined ? 1000 - rank : 0;
      items.push({ path, name, rel, score });
      continue;
    }

    const nameLow = name.toLowerCase();
    const relLow = rel.toLowerCase();
    const nameScore = fuzzyScore(nameLow, q);
    const relScore = fuzzyScore(relLow, q);

    if (nameScore === null && relScore === null) continue;

    // Prioritize matches in the filename over path-only matches.
    const best = Math.max(nameScore !== null ? nameScore + 200 : -Infinity, relScore ?? -Infinity);
    items.push({ path, name, rel, score: best });
  }

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return byName.compare(a.rel, b.rel);
  });

  return items;
}
