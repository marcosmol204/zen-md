import { describe, expect, test } from "vitest";
import { resolveMarkdownLink } from "./links";

describe("resolveMarkdownLink", () => {
  const root = "/workspace";
  const current = "/workspace/docs/guide.md";
  const files = new Set([
    "/workspace/README.md",
    "/workspace/docs/guide.md",
    "/workspace/docs/api.md",
  ]);

  test("ignores external URLs and mailto links", () => {
    expect(resolveMarkdownLink("https://example.com/a.md", current, root, files)).toBeNull();
    expect(resolveMarkdownLink("mailto:test@example.com", current, root, files)).toBeNull();
    expect(resolveMarkdownLink("//cdn.example.com/a.md", current, root, files)).toBeNull();
  });

  test("resolves same-file #anchor links", () => {
    expect(resolveMarkdownLink("#overview", current, root, files)).toEqual({
      path: "/workspace/docs/guide.md",
      anchor: "overview",
    });
  });

  test("resolves relative paths, parent paths, and extensionless known markdown files", () => {
    expect(resolveMarkdownLink("./api.md", current, root, files)).toEqual({
      path: "/workspace/docs/api.md",
      anchor: null,
    });
    expect(resolveMarkdownLink("../README.md#install", current, root, files)).toEqual({
      path: "/workspace/README.md",
      anchor: "install",
    });
    expect(resolveMarkdownLink("./api#auth", current, root, files)).toEqual({
      path: "/workspace/docs/api.md",
      anchor: "auth",
    });
  });

  test("rejects links that traverse outside workspace root", () => {
    expect(resolveMarkdownLink("../../secret.md", current, root, files)).toBeNull();
  });
});
