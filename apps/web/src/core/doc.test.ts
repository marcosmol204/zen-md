import { beforeEach, describe, expect, test } from "vitest";
import { Doc, type DocIO, type EditorPort } from "./doc";
import type { ReadResult } from "./text";

class FakeEditor implements EditorPort {
  text = "";
  loads = 0;
  externals = 0;
  ro = false;
  getText() { return this.text; }
  load(t: string) { this.text = t; this.loads++; }
  applyExternal(t: string) { this.text = t; this.externals++; }
  setReadOnly(r: boolean) { this.ro = r; }
}

class FakeIO implements DocIO {
  files = new Map<string, string>();
  invalid = new Set<string>();
  writes: [string, string][] = [];
  failWrites = false;
  gate: Promise<void> | null = null; // when set, reads wait for it
  async read(p: string): Promise<ReadResult> {
    if (this.gate) await this.gate;
    if (!this.files.has(p)) return { kind: "missing" };
    const text = this.files.get(p)!;
    return this.invalid.has(p) ? { kind: "invalid", text } : { kind: "ok", text };
  }
  async write(p: string, raw: string) {
    if (this.failWrites) throw new Error("disk full");
    this.writes.push([p, raw]);
    this.files.set(p, raw);
  }
}

const P = "/proj/plan.md";
let io: FakeIO, ed: FakeEditor, doc: Doc, changes: number;

beforeEach(async () => {
  io = new FakeIO();
  ed = new FakeEditor();
  changes = 0;
  doc = new Doc(io, ed, () => changes++, () => new Date(2026, 9, 1, 15, 30, 5));
  io.files.set(P, "# Plan\r\n\r\nStep 1\r\n");
  await doc.open(P);
});

describe("open", () => {
  test("loads LF text, clean, no banner", () => {
    expect(ed.text).toBe("# Plan\n\nStep 1\n");
    expect(ed.loads).toBe(1);
    expect(doc.dirty).toBe(false);
    expect(doc.banner).toBeNull();
    expect(ed.ro).toBe(false);
  });
  test("invalid UTF-8 opens read-only with notice; save is a no-op", async () => {
    io.files.set("/proj/bin.md", "h�i");
    io.invalid.add("/proj/bin.md");
    await doc.open("/proj/bin.md");
    expect(doc.readOnly).toBe(true);
    expect(ed.ro).toBe(true);
    expect(doc.banner).toEqual({ kind: "readonly" });
    await doc.save();
    expect(io.writes).toEqual([]);
  });
});

test("open of a missing file throws and keeps the current file", async () => {
  await expect(doc.open("/proj/nope.md")).rejects.toThrow("File not found");
  expect(doc.path).toBe(P);
});

describe("save", () => {
  test("edit one line keeps CRLF and only changes that line", async () => {
    ed.text = "# Plan\n\nStep ONE\n";
    expect(doc.dirty).toBe(true);
    await doc.save();
    expect(io.writes).toEqual([[P, "# Plan\r\n\r\nStep ONE\r\n"]]);
    expect(doc.dirty).toBe(false);
  });
  test("our own save echo is ignored", async () => {
    ed.text = "changed\n";
    await doc.save();
    await doc.onDiskChanged();
    expect(doc.banner).toBeNull();
    expect(ed.externals).toBe(0);
  });
  test("disk changed before save (no event yet): no write, banner changed", async () => {
    io.files.set(P, "agent wrote this\r\n");
    ed.text = "mine\n";
    await doc.save();
    expect(io.writes).toEqual([]);
    expect(doc.banner).toEqual({ kind: "changed" });
    expect(ed.text).toBe("mine\n");
  });
  test("write failure: error banner, still dirty", async () => {
    io.failWrites = true;
    ed.text = "mine\n";
    await doc.save();
    expect(doc.banner).toEqual({ kind: "error", message: "Error: disk full" });
    expect(doc.dirty).toBe(true);
  });
  test("undo back to disk content is clean again", () => {
    ed.text = "x";
    ed.text = "# Plan\n\nStep 1\n";
    expect(doc.dirty).toBe(false);
  });
});

describe("onDiskChanged", () => {
  test("clean buffer: applies externally, no banner", async () => {
    io.files.set(P, "# Plan\r\n\r\nStep 1\r\nStep 2\r\n");
    await doc.onDiskChanged();
    expect(ed.externals).toBe(1);
    expect(ed.text).toBe("# Plan\n\nStep 1\nStep 2\n");
    expect(doc.banner).toBeNull();
    expect(doc.dirty).toBe(false);
  });
  test("dirty buffer: banner changed, my text untouched", async () => {
    ed.text = "mine\n";
    io.files.set(P, "agent\r\n");
    await doc.onDiskChanged();
    expect(doc.banner).toEqual({ kind: "changed" });
    expect(ed.text).toBe("mine\n");
  });
  test("race: user types while disk read is pending", async () => {
    let release!: () => void;
    io.gate = new Promise((r) => (release = r));
    io.files.set(P, "agent\r\n");
    const pending = doc.onDiskChanged();
    ed.text = "typed during read\n";
    release();
    await pending;
    expect(doc.banner).toEqual({ kind: "changed" });
    expect(ed.text).toBe("typed during read\n");
  });
  test("stale read after switching files is ignored", async () => {
    io.files.set("/proj/b.md", "B\n");
    let release!: () => void;
    io.gate = new Promise((r) => (release = r));
    io.files.set(P, "A changed\n");
    const pending = doc.onDiskChanged();
    const opening = doc.open("/proj/b.md");
    release();
    await Promise.all([pending, opening]);
    expect(doc.path).toBe("/proj/b.md");
    expect(ed.text).toBe("B\n");
  });
  test("deleted: banner deleted", async () => {
    io.files.delete(P);
    await doc.onDiskChanged();
    expect(doc.banner).toEqual({ kind: "deleted" });
  });
  test("deleted then reappears with same content clears banner", async () => {
    io.files.delete(P);
    await doc.onDiskChanged();
    io.files.set(P, "# Plan\r\n\r\nStep 1\r\n");
    await doc.onDiskChanged();
    expect(doc.banner).toBeNull();
  });
  test("repeated disk changes while banner is up don't stack", async () => {
    ed.text = "mine\n";
    io.files.set(P, "a\n");
    await doc.onDiskChanged();
    io.files.set(P, "b\n");
    await doc.onDiskChanged();
    expect(doc.banner).toEqual({ kind: "changed" });
  });
});

describe("banner actions", () => {
  beforeEach(async () => {
    ed.text = "mine\n";
    io.files.set(P, "agent\r\n");
    await doc.onDiskChanged();
  });
  test("reload: takes disk, clean, banner cleared", async () => {
    await doc.reload();
    expect(ed.text).toBe("agent\n");
    expect(doc.dirty).toBe(false);
    expect(doc.banner).toBeNull();
  });
  test("saveCopy: writes my text to conflict copy, then reloads", async () => {
    await doc.saveCopy();
    expect(io.writes).toEqual([["/proj/plan.conflict-20261001-153005.md", "mine\r\n"]]);
    expect(ed.text).toBe("agent\n");
    expect(doc.banner).toBeNull();
  });
  test("keep: banner cleared, later disk change silent, save overwrites", async () => {
    doc.keep();
    expect(doc.banner).toBeNull();
    io.files.set(P, "agent again\r\n");
    await doc.onDiskChanged();
    expect(doc.banner).toBeNull();
    await doc.save();
    expect(io.files.get(P)).toBe("mine\r\n");
    expect(doc.dirty).toBe(false);
  });
  test("recreate after delete writes the file", async () => {
    io.files.delete(P);
    await doc.onDiskChanged();
    await doc.recreate();
    expect(io.files.get(P)).toBe("mine\r\n");
    expect(doc.banner).toBeNull();
  });
  test("close: no path, editor empty and read-only", () => {
    doc.close();
    expect(doc.path).toBeNull();
    expect(ed.text).toBe("");
    expect(ed.ro).toBe(true);
    expect(doc.dirty).toBe(false);
  });
});

test("moveTo updates path for later saves", async () => {
  doc.moveTo("/proj/renamed.md");
  io.files.set("/proj/renamed.md", io.files.get(P)!);
  ed.text = "x\n";
  await doc.save();
  expect(io.writes.at(-1)).toEqual(["/proj/renamed.md", "x\r\n"]);
});
