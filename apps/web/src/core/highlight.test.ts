import { expect, test } from "vitest";
import { htmlTokens } from "./highlight";

test("htmlTokens maps classed spans to offsets in the unescaped source", () => {
  const html = '<span class="hljs-keyword">const</span> x = <span class="hljs-string">&quot;a&lt;b&quot;</span>;';
  const src = 'const x = "a<b";';
  const tokens = htmlTokens(html);
  expect(tokens.map((t) => [src.slice(t.from, t.to), t.cls])).toEqual([["const", "hljs-keyword"], ['"a<b"', "hljs-string"]]);
});

test("nested spans carry every enclosing class", () => {
  const tokens = htmlTokens('<span class="a">x<span class="b">y</span></span>');
  expect(tokens).toEqual([{ from: 0, to: 1, cls: "a" }, { from: 1, to: 2, cls: "a b" }]);
});
