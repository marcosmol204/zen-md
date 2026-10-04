import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, text: string) {
  await page.addInitScript((t) => { window.__seed = { files: { "a.md": t }, lastFile: "a.md" }; }, text);
  await page.goto("/");
  await expect(page).toHaveTitle("a.md");
}

test("live preview hides markdown markers until the selection touches them", async ({ page }) => {
  await open(page, "intro\n\nSome **bold** text.\n");
  const line = page.locator(".cm-line", { hasText: "Some" });
  const marker = line.locator(".cm-formatting-inline").first();
  await expect(marker).toBeHidden();
  await line.click();
  await page.keyboard.press("ControlOrMeta+a"); // a selection touching the markers reveals them
  await expect(marker).toBeVisible();
});

test("a mermaid block renders as a diagram", async ({ page }) => {
  await open(page, "intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n");
  await expect(page.locator(".md-mermaid svg")).toBeVisible();
});

test("clicking a task checkbox toggles it and marks the doc dirty", async ({ page }) => {
  await open(page, "intro\n\n- [ ] ship it\n");
  const box = page.locator("input.md-task");
  await expect(box).not.toBeChecked();
  await box.click();
  await expect(box).toBeChecked();
  await expect(page).toHaveTitle("● a.md");
});

test("an agent rewrite shows up in the editor", async ({ page }) => {
  await open(page, "v1\n");
  await page.evaluate(() => window.__agent.write("a.md", "v2 from agent\n"));
  await expect(page.locator(".cm-content")).toContainText("v2 from agent");
});

test("right-click → Move to Trash confirms in an in-app dialog", async ({ page }) => {
  await open(page, "v1\n");
  await page.locator('#tree .row[data-path="/w/a.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Move “a.md” to Trash?");
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.locator("#tree .row")).toHaveCount(0);
  await expect(page).toHaveTitle("md-reader");
});

test("the welcome screen lists a recent file and reopens it", async ({ page }) => {
  await page.addInitScript(() => {
    window.__seed = { files: { "a.md": "hello from a\n" }, settings: { recentFiles: [{ path: "/w/a.md", root: "/w" }] } };
  });
  await page.goto("/");
  const welcome = page.locator("#welcome");
  await expect(welcome.getByRole("heading", { level: 1 })).toHaveText("md-reader");
  await welcome.getByRole("button", { name: /^a\.md/ }).click();
  await expect(page).toHaveTitle("a.md");
  await expect(page.locator(".cm-content")).toContainText("hello from a");
  await expect(welcome).toHaveCount(0);
});

const keywordColor = (page: Page) =>
  page.locator(".cm-editor .hljs-keyword").first().evaluate((el) => getComputedStyle(el).color);

test("code blocks get dark syntax colours in dark mode", async ({ page }) => {
  await open(page, "intro\n\n```js\nconst x = 1;\n```\n");
  expect(await keywordColor(page)).toBe("rgb(215, 58, 73)"); // GitHub light #d73a49
  await page.locator("#appearance").click(); // System (light OS) → Light
  await page.locator("#appearance").click(); // → Dark
  expect(await keywordColor(page)).toBe("rgb(255, 123, 114)"); // GitHub dark #ff7b72
});

test("a mermaid diagram redraws in the new theme", async ({ page }) => {
  await open(page, "intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n");
  const fill = () => page.locator(".md-mermaid .node rect").first().evaluate((el) => getComputedStyle(el).fill);
  await expect(page.locator(".md-mermaid svg")).toBeVisible();
  const light = await fill();
  await page.locator("#appearance").click();
  await page.locator("#appearance").click(); // Dark
  await expect.poll(fill).not.toBe(light);
});

test("a stored Dark mode is applied before the app script runs", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    // Record the theme the moment the document's own scripts start, before React mounts.
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") (window as any).__darkAtParse = document.documentElement.classList.contains("dark");
    }, { once: true });
  });
  await page.goto("/");
  expect(await page.evaluate(() => (window as any).__darkAtParse)).toBe(true);
  await expect(page.locator("#appearance")).toHaveAttribute("aria-label", "Appearance: Dark");
});

test("Source mode keeps the line at the top of the viewport in place", async ({ page }) => {
  // Tables and headings shrink in Source, so without anchoring the view would jump.
  const body = Array.from({ length: 60 }, (_, i) => `Line ${i}\n\n## H${i}\n\n| a | b |\n|---|---|\n| ${i} | x |\n`).join("\n");
  await open(page, `intro\n\n${body}`);
  const firstVisible = () => page.evaluate(() => {
    const top = document.querySelector(".cm-scroller")!.getBoundingClientRect().top;
    const line = [...document.querySelectorAll(".cm-line")].find((l) => /^Line \d+$/.test(l.textContent!) && l.getBoundingClientRect().top >= top);
    return line?.textContent;
  });
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await expect.poll(firstVisible).toMatch(/^Line \d+$/); // CodeMirror draws the new viewport a frame later
  const before = await firstVisible();
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.locator(".cm-content.md-source")).toBeVisible();
  await expect.poll(firstVisible).toBe(before);
});

test("the view-mode button sits below a banner, not over its buttons", async ({ page }) => {
  await open(page, "v1\n");
  await page.locator(".cm-content").click();
  await page.keyboard.type(" mine");
  await page.evaluate(() => window.__agent.write("a.md", "theirs\n"));
  const banner = page.locator("#banner");
  await expect(banner).toBeVisible();
  const [b, btn] = [await banner.boundingBox(), await page.locator("#view-mode").boundingBox()];
  expect(btn!.y).toBeGreaterThanOrEqual(b!.y + b!.height);
});

test("the paper sits at the left of the editor pane, its gutter growing with the pane", async ({ page }) => {
  // Column's left edge and left padding, relative to the editor pane.
  const paper = () => page.evaluate(() => {
    const pane = document.querySelector(".cm-scroller")!.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    return { offset: content.getBoundingClientRect().left - pane.left, padding: parseFloat(getComputedStyle(content).paddingLeft) };
  });
  await page.setViewportSize({ width: 1900, height: 800 });
  await page.addInitScript(() => { window.__seed = { files: { "a.md": "Some text.\n" }, settings: { recentFiles: [{ path: "/w/a.md", root: "/w" }] } }; });
  await page.goto("/");
  await page.locator("[data-recent-file] button.open").click();
  await expect(page).toHaveTitle("a.md");
  const wide = await paper();
  expect(wide.padding).toBe(96);
  expect(wide.offset).toBeLessThan(140); // gutters only; centered would be ~(pane - 760) / 2
  await page.setViewportSize({ width: 700, height: 800 });
  await expect.poll(async () => (await paper()).padding).toBe(32);
});
