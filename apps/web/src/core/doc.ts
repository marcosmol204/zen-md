import { conflictCopyPath, joinFormat, splitFormat, type Format, type ReadResult } from "./text";

export type DocIO = {
  read(path: string): Promise<ReadResult>;
  write(path: string, raw: string): Promise<void>;
};

export type EditorPort = {
  getText(): string;
  load(text: string): void;
  applyExternal(text: string): void;
  setReadOnly(ro: boolean): void;
};

export type Banner =
  | { kind: "changed" }
  | { kind: "deleted" }
  | { kind: "readonly" }
  | { kind: "error"; message: string }
  | null;

export class Doc {
  path: string | null = null;
  banner: Banner = null;
  readOnly = false;
  private diskRaw: string | null = null;
  private format: Format = { eol: "\n", bom: false };
  private keepMine = false;

  constructor(
    private io: DocIO,
    private editor: EditorPort,
    private onChange: () => void,
    private now: () => Date = () => new Date(),
  ) {}

  get dirty(): boolean {
    return this.path !== null && !this.readOnly && joinFormat(this.editor.getText(), this.format) !== this.diskRaw;
  }

  async open(path: string): Promise<void> {
    const prev = this.path;
    this.path = path; // set before the await so a stale onDiskChanged for the old file is dropped
    const r = await this.io.read(path);
    if (this.path !== path) return;
    if (r.kind === "missing") {
      this.path = prev;
      throw new Error(`File not found: ${path}`);
    }
    this.keepMine = false;
    this.readOnly = r.kind === "invalid";
    this.banner = this.readOnly ? { kind: "readonly" } : null;
    this.take(r.text, false);
    this.editor.setReadOnly(this.readOnly);
    this.onChange();
  }

  async onDiskChanged(): Promise<void> {
    const path = this.path;
    if (!path || this.readOnly) return;
    const r = await this.io.read(path);
    if (path !== this.path) return;
    if (r.kind === "missing") return this.set({ kind: "deleted" });
    if (r.kind === "invalid") return;
    if (this.banner?.kind === "deleted") this.banner = null;
    if (r.text === this.diskRaw) return this.onChange();
    if (!this.dirty) {
      if (this.banner?.kind === "changed") this.banner = null;
      this.take(r.text, true);
      return this.onChange();
    }
    if (this.keepMine) return;
    this.set({ kind: "changed" });
  }

  async save(): Promise<void> {
    const path = this.path;
    if (!path || this.readOnly) return;
    const raw = joinFormat(this.editor.getText(), this.format);
    if (!this.keepMine) {
      const r = await this.io.read(path);
      const disk = r.kind === "missing" ? null : r.text;
      if (disk !== this.diskRaw) return this.set(r.kind === "missing" ? { kind: "deleted" } : { kind: "changed" });
    }
    try {
      await this.io.write(path, raw);
    } catch (e) {
      return this.set({ kind: "error", message: String(e) });
    }
    this.diskRaw = raw;
    this.keepMine = false;
    this.set(null);
  }

  async reload(): Promise<void> {
    const path = this.path;
    if (!path) return;
    const r = await this.io.read(path);
    if (path !== this.path) return;
    if (r.kind === "missing") return this.set({ kind: "deleted" });
    if (r.kind === "invalid") return this.open(path);
    this.keepMine = false;
    this.banner = null;
    this.take(r.text, true);
    this.onChange();
  }

  async saveCopy(): Promise<void> {
    if (!this.path) return;
    try {
      await this.io.write(conflictCopyPath(this.path, this.now()), joinFormat(this.editor.getText(), this.format));
    } catch (e) {
      return this.set({ kind: "error", message: String(e) });
    }
    await this.reload();
  }

  async recreate(): Promise<void> {
    this.keepMine = true;
    await this.save();
  }

  keep(): void {
    this.keepMine = true;
    this.set(null);
  }

  dismiss(): void {
    this.set(null);
  }

  close(): void {
    this.path = null;
    this.diskRaw = null;
    this.banner = null;
    this.readOnly = false;
    this.keepMine = false;
    this.editor.load("");
    this.editor.setReadOnly(true);
    this.onChange();
  }

  moveTo(path: string): void {
    this.path = path;
    this.onChange();
  }

  private take(raw: string, external: boolean) {
    const { text, format } = splitFormat(raw);
    this.diskRaw = raw;
    this.format = format;
    if (external) this.editor.applyExternal(text);
    else this.editor.load(text);
  }

  private set(b: Banner) {
    this.banner = b;
    this.onChange();
  }
}
