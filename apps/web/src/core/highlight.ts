// Highlighter output (highlight.js-style `<span class="hljs-…">` HTML) back into ranges over the source
// text, so editable code lines in Preview can be coloured in place.

export type Token = { from: number; to: number; cls: string };

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&#39;": "'" };

/** Ranges of the innermost classed span over each piece of text, in offsets of the unescaped text. */
export function htmlTokens(html: string): Token[] {
  const out: Token[] = [];
  const stack: string[] = [];
  let pos = 0;
  for (const m of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    if (m[1] !== undefined) stack.push(m[1]);
    else if (m[0] === "</span>") stack.pop();
    else {
      const len = m[2].replace(/&(?:amp|lt|gt|quot|#0?39);/g, (e) => entities[e]).length;
      if (stack.length) out.push({ from: pos, to: pos + len, cls: stack.join(" ") });
      pos += len;
    }
  }
  return out;
}
