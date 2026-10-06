// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boot, tempFolder, until, type App } from "./app";
import { THEME_KEY } from "@/platform/theme";

let app: App;
afterEach(async () => {
  try {
    await app?.dispose();
  } finally {
    vi.restoreAllMocks();
  }
});

describe("folder", () => {
  test("opening a folder lists its markdown files, hiding .git and node_modules", async () => {
    app = await boot({
      files: { "a.md": "", "notes.txt": "", "docs/b.md": "", ".git/x.md": "", "node_modules/y.md": "" },
    });
    expect(app.rows()).toEqual(["docs", "a.md"]);
  });

  test("Open Folder… lists the picked folder", async () => {
    app = await boot({ files: { "a.md": "" }, settings: {} });
    expect(app.rows()).toEqual([]);
    app.stub.answers.pickFolder.push(app.root);
    app.$("#open-folder")!.click();
    await until(() => expect(app.rows()).toEqual(["a.md"]));
  });
});

/** A folder read that waits until released, or fails when rejected. */
function gate() {
  let release!: () => void, fail!: () => void;
  const wait = new Promise<void>((res, rej) => { release = res; fail = () => rej(new Error("read failed")); });
  return { wait, release, fail };
}

describe("loading a folder", () => {
  const idle = { overlay: null, busy: false };
  const shown = { overlay: "Loading…", busy: true };

  test("an overlay covers the app while the folder is read, then goes away", async () => {
    app = await boot({ files: { "a.md": "" } });
    const other = await tempFolder({ "b.md": "" });
    const g = gate();
    app.stub.ctl.hold = (dir) => (dir === other ? g.wait : Promise.resolve());
    app.stub.answers.pickFolder.push(other);
    app.$("#open-folder")!.click();
    await until(() => expect(app.loading()).toEqual(shown));
    g.release();
    await until(() => expect(app.paths()).toEqual([join(other, "b.md")]));
    expect(app.loading()).toEqual(idle);
  });

  test("a failed folder read still clears the overlay", async () => {
    app = await boot({ files: { "a.md": "" } });
    const other = await tempFolder({ "b.md": "" });
    const g = gate();
    app.stub.ctl.hold = (dir) => (dir === other ? g.wait : Promise.resolve());
    app.stub.answers.pickFolder.push(other);
    app.$("#open-folder")!.click();
    await until(() => expect(app.loading()).toEqual(shown));
    g.fail();
    await until(() => expect(app.loading()).toEqual(idle));
    expect(app.paths()).toEqual([]);
  });

  test("the last folder opened wins when an earlier one is still loading", async () => {
    app = await boot({ files: { "a.md": "" } });
    const first = await tempFolder({ "x.md": "" });
    const second = await tempFolder({ "y.md": "" });
    const g1 = gate(), g2 = gate();
    app.stub.ctl.hold = (dir) => (dir === first ? g1.wait : dir === second ? g2.wait : Promise.resolve());
    app.stub.answers.pickFolder.push(first, second);
    app.$("#open-folder")!.click();
    await until(() => expect(app.loading()).toEqual(shown));
    // The overlay blocks the UI; drive the controller directly, like a restore racing a pick would.
    app.$("#open-folder")!.click();
    await until(() => expect(app.stub.answers.pickFolder).toEqual([]));
    g2.release();
    await until(() => expect(app.paths()).toEqual([join(second, "y.md")]));
    g1.release();
    await new Promise((r) => setTimeout(r, 30));
    expect(app.paths()).toEqual([join(second, "y.md")]);
    expect(app.loading()).toEqual(idle);
    expect(app.stub.settings.recentFolders![0]).toBe(second);
  });

  test("the overlay stays until the newest folder has loaded", async () => {
    app = await boot({ files: { "a.md": "" } });
    const first = await tempFolder({ "x.md": "" });
    const second = await tempFolder({ "y.md": "" });
    const g1 = gate(), g2 = gate();
    app.stub.ctl.hold = (dir) => (dir === first ? g1.wait : dir === second ? g2.wait : Promise.resolve());
    app.stub.answers.pickFolder.push(first, second);
    app.$("#open-folder")!.click();
    await until(() => expect(app.loading()).toEqual(shown));
    app.$("#open-folder")!.click();
    await until(() => expect(app.stub.answers.pickFolder).toEqual([]));
    g1.release();
    await new Promise((r) => setTimeout(r, 30));
    expect(app.loading()).toEqual(shown);
    g2.release();
    await until(() => expect(app.loading()).toEqual(idle));
  });
});

describe("agent writes while the folder is open", () => {
  test("a new markdown file appears in the tree", async () => {
    app = await boot({ files: { "a.md": "" } });
    await app.write("plan.md", "# Plan");
    await until(() => expect(app.rows()).toEqual(["a.md", "plan.md"]));
  });

  test("a deleted file disappears from the tree", async () => {
    app = await boot({ files: { "a.md": "", "b.md": "" } });
    await app.remove("b.md");
    await until(() => expect(app.rows()).toEqual(["a.md"]));
  });

  test("a burst of files all land in the tree", async () => {
    app = await boot({ files: { "a.md": "" } });
    await Promise.all(Array.from({ length: 20 }, (_, i) => app.write(`n${String(i).padStart(2, "0")}.md`, "")));
    await until(() => expect(app.rows()).toHaveLength(21));
  });
});

describe("open document", () => {
  test("clicking a row opens the file in the editor", async () => {
    app = await boot({ files: { "a.md": "alpha", "b.md": "beta" } });
    app.click("b.md");
    await until(() => expect(app.text()).toBe("beta"));
    expect(app.title()).toBe("b.md");
    expect(app.row("b.md")!.classList).toContain("active");
  });

  test("an agent rewrite of a clean file reloads it in place", async () => {
    app = await boot({ files: { "a.md": "v1" }, lastFile: "a.md" });
    await app.write("a.md", "v2");
    await until(() => expect(app.text()).toBe("v2"));
    expect(app.banner()).toBeNull();
  });

  test("Cmd+S saves edits and keeps CRLF line endings and the BOM", async () => {
    app = await boot({ files: { "a.md": "﻿one\r\ntwo\r\n" }, lastFile: "a.md" });
    app.type("three\n");
    expect(app.title()).toBe("● a.md");
    app.save();
    await until(() => expect(app.title()).toBe("a.md"));
    expect(await app.read("a.md")).toBe("﻿one\r\ntwo\r\nthree\r\n");
  });

  test("booting opens the requested last file", async () => {
    app = await boot({ files: { "a.md": "alpha", "b.md": "beta" }, lastFile: "b.md" });
    expect(app.text()).toBe("beta");
    expect(app.row("b.md")!.classList).toContain("active");
  });

  test("launching the app opens to the welcome screen, not the last folder", async () => {
    app = await boot({ files: { "a.md": "alpha" }, openFolder: false });
    expect(app.welcome()!.heading).toBe("md-reader");
    expect(app.rows()).toEqual([]);
  });

  test("startup comes up empty when the last folder is gone", async () => {
    app = await boot({ settings: { lastFolder: "/nope/gone" } });
    expect(app.rows()).toEqual([]);
    expect(app.welcome()!.heading).toBe("md-reader");
  });

  test("a watcher failure shows Not watching, and Retry recovers", async () => {
    app = await boot({ files: { "a.md": "" }, failWatch: true });
    expect(app.status()).toMatch(/^Not watching/);
    app.stub.ctl.failWatch = false;
    app.button("Retry");
    await until(() => expect(app.status()).toBeNull());
    await app.write("b.md", "");
    await until(() => expect(app.rows()).toEqual(["a.md", "b.md"]));
  });
});

describe("conflicts with an agent", () => {
  async function conflicted() {
    app = await boot({ files: { "a.md": "v1" }, lastFile: "a.md" });
    app.type(" mine");
    await app.write("a.md", "theirs");
    await until(() => expect(app.banner()).toBe("File changed on disk."));
  }

  test("an agent rewrite under unsaved edits shows the changed banner and keeps my text", async () => {
    await conflicted();
    expect(app.text()).toBe("v1 mine");
  });

  test("Reload takes the disk version", async () => {
    await conflicted();
    app.button("Reload");
    await until(() => expect(app.text()).toBe("theirs"));
    expect(app.banner()).toBeNull();
  });

  test("Save mine as copy writes a conflict copy and reloads the disk version", async () => {
    await conflicted();
    app.button("Save mine as copy");
    await until(() => expect(app.text()).toBe("theirs"));
    const copy = () => app.rows().find((r) => /^a\.conflict-\d{8}-\d{6}\.md$/.test(r));
    await until(() => expect(copy()).toBeDefined());
    expect(await app.read(copy()!)).toBe("v1 mine");
  });

  test("Keep mine, then Cmd+S, overwrites the agent's version", async () => {
    await conflicted();
    app.button("Keep mine");
    expect(app.banner()).toBeNull();
    app.save();
    await until(async () => expect(await app.read("a.md")).toBe("v1 mine"));
  });

  test("an agent deleting the open file shows the deleted banner, and recreate writes it back", async () => {
    app = await boot({ files: { "a.md": "keep me" }, lastFile: "a.md" });
    await app.remove("a.md");
    await until(() => expect(app.banner()).toBe("File deleted on disk."));
    app.button("Save to recreate");
    await until(async () => expect(await app.read("a.md")).toBe("keep me"));
    await until(() => expect(app.banner()).toBeNull());
  });
});

describe("file operations", () => {
  test("New File creates untitled.md, opens it, and Enter renames it", async () => {
    app = await boot({ files: { "a.md": "" } });
    await app.contextMenu(null, "New File");
    await until(() => expect(app.$("#tree input.rename")).not.toBeNull());
    expect(await app.read("untitled.md")).toBe("");
    await app.renameTo("ideas");
    await until(() => expect(app.rows()).toEqual(["a.md", "ideas.md"]));
    expect(app.title()).toBe("ideas.md");
  });

  test("New Folder creates a folder with untitled.md inside and opens it", async () => {
    app = await boot({ files: { "a.md": "" } });
    await app.contextMenu(null, "New Folder");
    await until(() => expect(app.title()).toBe("untitled.md"));
    expect(await app.read("New Folder/untitled.md")).toBe("");
    expect(app.rows()).toEqual(["New Folder", "New Folder/untitled.md", "a.md"]);
  });

  test("renaming the open file keeps it open at the new path", async () => {
    app = await boot({ files: { "a.md": "alpha" }, lastFile: "a.md" });
    await app.contextMenu("a.md", "Rename");
    await app.renameTo("b");
    await until(() => expect(app.rows()).toEqual(["b.md"]));
    expect(app.title()).toBe("b.md");
    app.type("!");
    app.save();
    await until(async () => expect(await app.read("b.md")).toBe("alpha!"));
  });

  test("renaming onto an existing name shows an inline error and changes nothing", async () => {
    app = await boot({ files: { "a.md": "", "b.md": "" } });
    await app.contextMenu("a.md", "Rename");
    await app.renameTo("b.md");
    const input = () => app.$<HTMLInputElement>("#tree input.rename")!;
    await until(() => expect(input().title).toBe("Already exists"));
    expect(input().classList).toContain("invalid");
    expect(await app.read("a.md")).toBe("");
  });

  test("renaming to an invalid name shows an inline error and changes nothing", async () => {
    app = await boot({ files: { "a.md": "" } });
    await app.contextMenu("a.md", "Rename");
    await app.renameTo("a/b");
    const input = () => app.$<HTMLInputElement>("#tree input.rename")!;
    await until(() => expect(input().title).toBe("Name can't contain /"));
    expect(app.rows()).toEqual(["a.md"]);
  });

  test("Move to Trash on the open dirty file asks to save first, then removes it", async () => {
    app = await boot({ files: { "a.md": "x", "b.md": "" }, lastFile: "a.md" });
    app.type("y");
    await app.contextMenu("a.md", "Move to Trash");
    await until(() => expect(app.dialog()).toBe("Move “a.md” to Trash?"));
    await app.choose("Move to Trash");
    await until(() => expect(app.dialog()).toBe("Save changes to “a.md”?"));
    await app.choose("Discard");
    await until(() => expect(app.rows()).toEqual(["b.md"]));
    expect(app.title()).toBe("md-reader");
    expect(app.dialog()).toBeNull();
  });

  test("declining the trash confirmation keeps the file", async () => {
    app = await boot({ files: { "a.md": "x" } });
    await app.contextMenu("a.md", "Move to Trash");
    await app.choose("Cancel");
    await until(() => expect(app.dialog()).toBeNull());
    expect(await app.read("a.md")).toBe("x");
    expect(app.rows()).toEqual(["a.md"]);
  });
});

describe("unsaved changes", () => {
  async function dirtyA() {
    app = await boot({ files: { "a.md": "a", "b.md": "b" }, lastFile: "a.md" });
    app.type("!");
  }

  test("Cancel on switching stays on the dirty file", async () => {
    await dirtyA();
    app.click("b.md");
    await app.choose("Cancel");
    await until(() => expect(app.dialog()).toBeNull());
    expect(app.text()).toBe("a!");
    expect(app.title()).toBe("● a.md");
  });

  test("Discard on switching drops the edits", async () => {
    await dirtyA();
    app.click("b.md");
    await app.choose("Discard");
    await until(() => expect(app.text()).toBe("b"));
    expect(await app.read("a.md")).toBe("a");
  });

  test("Save on switching writes the edits first", async () => {
    await dirtyA();
    app.click("b.md");
    await app.choose("Save");
    await until(() => expect(app.text()).toBe("b"));
    expect(await app.read("a.md")).toBe("a!");
  });

  test("closing the window with unsaved edits asks, and Cancel keeps it open", async () => {
    await dirtyA();
    let closing = app.stub.requestClose();
    await app.choose("Cancel");
    expect(await closing).toBe(false);
    closing = app.stub.requestClose();
    await app.choose("Save");
    expect(await closing).toBe(true);
    expect(await app.read("a.md")).toBe("a!");
  });

  test("Discard on close lets the window close without saving", async () => {
    await dirtyA();
    const closing = app.stub.requestClose();
    await app.choose("Discard");
    expect(await closing).toBe(true);
    expect(await app.read("a.md")).toBe("a");
  });
});

describe("welcome screen and recents", () => {
  const recentFilePaths = () => app.stub.settings.recentFiles?.map((f) => f.path);

  test("with a folder open and no file, the welcome screen still says md-reader", async () => {
    app = await boot({ files: { "a.md": "" } });
    expect(app.welcome()!.heading).toBe("md-reader");
    app.click("a.md");
    await until(() => expect(app.welcome()).toBeNull());
  });

  test("New File… on the welcome screen needs an open folder, and creates untitled.md there", async () => {
    app = await boot({ settings: {} });
    expect(app.welcome()!.actions).toEqual(["Open Folder…"]);
    await app.dispose();
    app = await boot({ files: { "a.md": "" } });
    expect(app.welcome()!.actions).toEqual(["Open Folder…", "New File…"]);
    app.button("New File…");
    await until(() => expect(app.title()).toBe("untitled.md"));
    expect(app.rows()).toEqual(["a.md", "untitled.md"]);
  });

  test("Recent lists folders then files, five at a time; More… shows the rest", async () => {
    const dirs = await Promise.all([1, 2, 3, 4].map((n) => tempFolder({ [`f${n}.md`]: "" })));
    app = await boot({
      settings: {
        recentFolders: dirs,
        recentFiles: dirs.map((d, i) => ({ path: join(d, `f${i + 1}.md`), root: d })),
      },
    });
    await until(() => expect(app.welcome()!.folders).toEqual(dirs));
    expect(app.welcome()!.files).toEqual([join(dirs[0], "f1.md")]);
    app.button("More…");
    await until(() => expect(app.welcome()!.files).toHaveLength(4));
  });

  test("recent folders and files are listed newest first; missing ones are hidden, not deleted", async () => {
    const one = await tempFolder({ "x.md": "" });
    const two = await tempFolder({ "y.md": "" });
    app = await boot({
      settings: {
        recentFolders: [two, "/nope/gone", one],
        recentFiles: [{ path: join(one, "x.md"), root: one }, { path: "/nope/gone/z.md", root: "/nope/gone" }, { path: join(two, "y.md"), root: two }],
      },
    });
    await until(() => expect(app.welcome()).toEqual({
      heading: "md-reader",
      actions: ["Open Folder…"],
      folders: [two, one],
      files: [join(one, "x.md"), join(two, "y.md")],
    }));
    expect(app.stub.settings.recentFolders).toEqual([two, "/nope/gone", one]);
  });

  test("old settings without recents start with empty lists", async () => {
    app = await boot({ settings: { lastFolder: "/nope/gone" } });
    await until(() => expect(app.welcome()).toEqual({ heading: "md-reader", actions: ["Open Folder…"], folders: [], files: [] }));
  });

  test("opening a folder or file moves it to the top without duplicating it", async () => {
    const other = await tempFolder({ "x.md": "" });
    app = await boot({
      files: { "a.md": "", "b.md": "" },
      settings: (root) => ({
        lastFolder: root,
        recentFolders: [other, root],
        recentFiles: [{ path: join(root, "a.md"), root }, { path: join(root, "b.md"), root }],
      }),
    });
    await until(() => expect(app.stub.settings.recentFolders).toEqual([app.root, other]));
    app.click("b.md");
    await until(() => expect(recentFilePaths()).toEqual([app.at("b.md"), app.at("a.md")]));
  });

  test("clicking a recent file opens its folder, then the file", async () => {
    const other = await tempFolder({ "x.md": "from x", "y.md": "" });
    app = await boot({ files: { "a.md": "" }, settings: (root) => ({ lastFolder: root, recentFiles: [{ path: join(other, "x.md"), root: other }] }) });
    await until(() => expect(app.welcome()!.files).toEqual([join(other, "x.md")]));
    app.clickRecent(join(other, "x.md"));
    await until(() => expect(app.text()).toBe("from x"));
    expect(app.title()).toBe("x.md");
    expect(app.$(`#tree .row[data-path="${join(other, "y.md")}"]`)).not.toBeNull();
    expect(app.stub.settings.recentFolders![0]).toBe(other);
  });

  test("clicking a recent folder opens it", async () => {
    const other = await tempFolder({ "x.md": "" });
    app = await boot({ settings: { recentFolders: [other] } });
    await until(() => expect(app.welcome()!.folders).toEqual([other]));
    app.clickRecent(other);
    await until(() => expect(app.$(`#tree .row[data-path="${join(other, "x.md")}"]`)).not.toBeNull());
  });

  test("a recent file deleted while the welcome screen is up is dropped when clicked, without leaving its folder", async () => {
    const other = await tempFolder({ "x.md": "" });
    app = await boot({ files: { "a.md": "" }, settings: (root) => ({ lastFolder: root, recentFiles: [{ path: join(other, "x.md"), root: other }] }) });
    await until(() => expect(app.welcome()!.files).toEqual([join(other, "x.md")]));
    await rm(join(other, "x.md"));
    app.clickRecent(join(other, "x.md"));
    await until(() => expect(app.welcome()!.files).toEqual([]));
    expect(app.rows()).toEqual(["a.md"]);
    expect(app.stub.settings.recentFiles).toEqual([]);
  });

  test("× removes one recent entry", async () => {
    const one = await tempFolder();
    const two = await tempFolder();
    app = await boot({ settings: { recentFolders: [one, two] } });
    await until(() => expect(app.welcome()!.folders).toEqual([one, two]));
    app.removeRecent(one);
    await until(() => expect(app.welcome()!.folders).toEqual([two]));
    expect(app.stub.settings.recentFolders).toEqual([two]);
  });

  test("renaming a file updates its recent entry and Move to Trash removes it", async () => {
    app = await boot({ files: { "a.md": "", "b.md": "" }, lastFile: "a.md" });
    await until(() => expect(recentFilePaths()).toEqual([app.at("a.md")]));
    await app.contextMenu("a.md", "Rename");
    await app.renameTo("c");
    await until(() => expect(recentFilePaths()).toEqual([app.at("c.md")]));
    app.click("b.md");
    await until(() => expect(recentFilePaths()).toEqual([app.at("b.md"), app.at("c.md")]));
    await app.contextMenu("c.md", "Move to Trash");
    await app.choose("Move to Trash");
    await until(() => expect(recentFilePaths()).toEqual([app.at("b.md")]));
  });
});

describe("appearance", () => {
  test("the sidebar toggle cycles System → Light → Dark → System", async () => {
    app = await boot({ osDark: true });
    expect(app.appearance()).toEqual({ label: "Appearance: System", dark: true });
    app.toggleAppearance();
    expect(app.appearance()).toEqual({ label: "Appearance: Light", dark: false });
    app.toggleAppearance();
    expect(app.appearance()).toEqual({ label: "Appearance: Dark", dark: true });
    app.toggleAppearance();
    expect(app.appearance()).toEqual({ label: "Appearance: System", dark: true });
  });

  test("the chosen mode survives a relaunch", async () => {
    app = await boot();
    app.toggleAppearance();
    app.toggleAppearance();
    const stored = localStorage.getItem(THEME_KEY)!;
    await app.dispose();
    app = await boot({ storedTheme: stored });
    expect(app.appearance()).toEqual({ label: "Appearance: Dark", dark: true });
  });

  test("a missing or garbled stored mode starts in System", async () => {
    app = await boot({ storedTheme: "purple", osDark: true });
    expect(app.appearance()).toEqual({ label: "Appearance: System", dark: true });
  });

  test("System follows a live OS appearance change; a forced mode ignores it", async () => {
    app = await boot({ osDark: false });
    app.setOsDark(true);
    await until(() => expect(app.appearance().dark).toBe(true));
    app.toggleAppearance(); // Light
    app.setOsDark(false);
    app.setOsDark(true);
    expect(app.appearance()).toEqual({ label: "Appearance: Light", dark: false });
  });

  test("the window titlebar follows the mode (null hands it back to the OS)", async () => {
    app = await boot({ storedTheme: "dark" });
    expect(app.stub.windowThemes).toEqual(["dark"]);
    app.toggleAppearance();
    app.toggleAppearance();
    expect(app.stub.windowThemes).toEqual(["dark", null, "light"]);
  });

  test("switching mode mid-edit keeps the unsaved text", async () => {
    app = await boot({ files: { "a.md": "alpha" }, lastFile: "a.md" });
    app.type(" beta");
    app.toggleAppearance();
    expect(app.text()).toBe("alpha beta");
    expect(app.title()).toBe("● a.md");
  });
});

describe("view mode", () => {
  const md = "intro\n\n## Heading **bold**\n";

  test("starts Formatted; Cmd+E shows the raw markdown and back", async () => {
    app = await boot({ files: { "a.md": md }, lastFile: "a.md" });
    expect(app.shown()).not.toContain("## Heading");
    app.pressViewKey();
    expect(app.shown()).toContain("## Heading **bold**");
    app.pressViewKey();
    expect(app.shown()).not.toContain("## Heading");
  });

  test("the editor button toggles too, and says what it will switch to", async () => {
    app = await boot({ files: { "a.md": md }, lastFile: "a.md" });
    expect(app.viewButton()).toBe("Show source");
    app.clickViewMode();
    expect(app.viewButton()).toBe("Show formatted");
    expect(app.shown()).toContain("## Heading **bold**");
    app.clickViewMode();
    expect(app.viewButton()).toBe("Show source");
  });

  test("on the welcome screen there is no button and Cmd+E does nothing", async () => {
    app = await boot({ files: { "a.md": md } });
    expect(app.welcome()).not.toBeNull();
    expect(app.viewButton()).toBeNull();
    app.pressViewKey();
    app.click("a.md");
    await until(() => expect(app.title()).toBe("a.md"));
    expect(app.viewButton()).toBe("Show source");
  });

  test("toggling never touches the file or marks it unsaved; Source edits save byte-for-byte", async () => {
    app = await boot({ files: { "a.md": md }, lastFile: "a.md" });
    app.pressViewKey();
    expect(app.title()).toBe("a.md");
    expect(app.text()).toBe(md);
    app.type("| x |\n");
    app.save();
    await until(async () => expect(await app.read("a.md")).toBe(md + "| x |\n"));
  });

  test("the mode stays when switching files", async () => {
    app = await boot({ files: { "a.md": md, "b.md": "top\n\n## B\n" }, lastFile: "a.md" });
    app.pressViewKey();
    app.click("b.md");
    await until(() => expect(app.title()).toBe("b.md"));
    expect(app.viewButton()).toBe("Show formatted");
    expect(app.shown()).toContain("## B");
  });

  test("undo after a toggle undoes my last edit", async () => {
    app = await boot({ files: { "a.md": md }, lastFile: "a.md" });
    app.type("x");
    app.pressViewKey();
    app.undo();
    expect(app.text()).toBe(md);
  });

  test("a read-only file stays read-only in Source", async () => {
    app = await boot({ files: { "a.md": md } });
    await writeFile(app.at("bad.md"), Buffer.from([0x23, 0x20, 0xff, 0xfe]));
    await until(() => expect(app.rows()).toContain("bad.md"));
    app.click("bad.md");
    await until(() => expect(app.banner()).toBe("Not valid UTF-8, opened read-only."));
    app.pressViewKey();
    expect(app.viewButton()).toBe("Show formatted");
    expect(app.editable()).toBe(false);
  });

  test("only the platform's command key toggles: Ctrl+E on macOS stays CodeMirror's end-of-line", async () => {
    app = await boot({ files: { "a.md": md }, lastFile: "a.md" });
    app.pressViewKey(true);
    expect(app.viewButton()).toBe("Show source");
  });
});

describe("sidebar width", () => {
  const sidebarWidth = () => app.$("#sidebar")!.style.width;
  const viewport = (width: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width });
  const setWindowWidth = (width: number) => {
    viewport(width);
    window.dispatchEvent(new Event("resize"));
  };
  afterEach(() => viewport(1024));
  const handle = () => app.$("#sidebar-handle")!;
  const pointer = (type: string, clientX: number) =>
    handle().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1, button: 0 }));

  test("dragging the handle resizes the sidebar and saves the width on release", async () => {
    app = await boot({ files: { "a.md": "" } });
    expect(sidebarWidth()).toBe("260px");
    pointer("pointerdown", 260);
    pointer("pointermove", 340);
    expect(sidebarWidth()).toBe("340px");
    expect(app.stub.settings.sidebarWidth).not.toBe(340);
    pointer("pointerup", 340);
    expect(app.stub.settings.sidebarWidth).toBe(340);
  });

  test("a cancelled drag ends: the sidebar stops following the pointer", async () => {
    app = await boot({ files: { "a.md": "" } });
    pointer("pointerdown", 260);
    pointer("pointermove", 300);
    pointer("lostpointercapture", 300);
    expect(app.stub.settings.sidebarWidth).toBe(300);
    pointer("pointermove", 400);
    expect(sidebarWidth()).toBe("300px");
  });

  test("the width stops at 180px and at half the window", async () => {
    app = await boot({ files: { "a.md": "" } });
    setWindowWidth(1000);
    pointer("pointerdown", 260);
    pointer("pointermove", 10);
    expect(sidebarWidth()).toBe("180px");
    pointer("pointermove", 2000);
    expect(sidebarWidth()).toBe("500px");
    pointer("pointerup", 2000);
    expect(app.stub.settings.sidebarWidth).toBe(500);
  });

  test("double-clicking the handle resets the width to 260px", async () => {
    app = await boot({ settings: (root) => ({ lastFolder: root, sidebarWidth: 400 }) });
    expect(sidebarWidth()).toBe("400px");
    handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(sidebarWidth()).toBe("260px");
    expect(app.stub.settings.sidebarWidth).toBe(260);
  });

  test("arrow keys on the focused handle resize by 16px and save on key up", async () => {
    app = await boot({ files: { "a.md": "" } });
    const key = (type: string, key: string) => handle().dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    expect(handle().getAttribute("role")).toBe("separator");
    expect(handle().tabIndex).toBe(0);
    key("keydown", "ArrowRight");
    key("keydown", "ArrowRight");
    expect(sidebarWidth()).toBe("292px");
    expect(handle().getAttribute("aria-valuenow")).toBe("292");
    expect(app.stub.settings.sidebarWidth).not.toBe(292);
    key("keyup", "ArrowRight");
    expect(app.stub.settings.sidebarWidth).toBe(292);
    key("keydown", "ArrowLeft");
    expect(sidebarWidth()).toBe("276px");
  });

  test("startup restores the saved width, and falls back to 260px when it is missing or invalid", async () => {
    app = await boot({ settings: (root) => ({ lastFolder: root, sidebarWidth: 320 }) });
    expect(sidebarWidth()).toBe("320px");
    await app.dispose();
    app = await boot({ settings: (root) => ({ lastFolder: root, sidebarWidth: "wide" as unknown as number }) });
    expect(sidebarWidth()).toBe("260px");
    expect(handle().getAttribute("aria-valuenow")).toBe("260");
  });

  test("a narrow window clamps the shown width but keeps the saved one", async () => {
    app = await boot({ settings: (root) => ({ lastFolder: root, sidebarWidth: 450 }) });
    expect(sidebarWidth()).toBe("450px");
    setWindowWidth(600);
    expect(sidebarWidth()).toBe("300px");
    expect(app.stub.settings.sidebarWidth).toBe(450);
    setWindowWidth(1024);
    expect(sidebarWidth()).toBe("450px");
  });
});
