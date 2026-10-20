import { describe, expect, test } from "vitest";
import { cleanHeadingText, extractHeadings, slugifyHeading } from "./outline";

describe("cleanHeadingText and slugifyHeading", () => {
  test("strips inline markdown formatting and builds GitHub-compatible slugs", () => {
    expect(cleanHeadingText("Hello **World** with `code` and [link](https://x.dev)")).toBe(
      "Hello World with code and link",
    );
    expect(slugifyHeading("4.1 Watcher & External Updates")).toBe("41-watcher-external-updates");
  });
});

describe("extractHeadings", () => {
  test("extracts ATX and Setext headings while ignoring fenced code blocks", () => {
    const md = [
      "# Main Title",
      "",
      "```sh",
      "# comment in code block",
      "```",
      "",
      "## Section **One** ##",
      "",
      "Setext Two",
      "----------",
      "",
      "### Section One",
    ].join("\n");

    const list = extractHeadings(md);
    expect(list).toEqual([
      { level: 1, text: "Main Title", slug: "main-title", from: 0, line: 1 },
      { level: 2, text: "Section One", slug: "section-one", from: md.indexOf("## Section"), line: 7 },
      { level: 2, text: "Setext Two", slug: "setext-two", from: md.indexOf("Setext Two"), line: 9 },
      { level: 3, text: "Section One", slug: "section-one-1", from: md.indexOf("### Section"), line: 12 },
    ]);
  });
});
