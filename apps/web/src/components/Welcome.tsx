import { useEffect, useState } from "react";
import { FilePlus, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isMac } from "@/lib/utils";
import { baseName, parentOf } from "@/core/tree";
import type { RecentFile } from "@/core/recents";

type Props = {
  /** The open folder, or null; New File… needs one. */
  folder: string | null;
  folders: string[];
  files: RecentFile[];
  exists(path: string): Promise<boolean>;
  on: { pickFolder(): void; newFile(): void; openFolder(dir: string): void; openFile(f: RecentFile): void; remove(path: string): void };
};

const shortcut = isMac ? "⌘O" : "Ctrl+O";
const SHOWN = 5;
// ponytail: guesses the home dir from the path shape (macOS/Linux); ask Tauri's homeDir() if Windows paths need it.
const tilde = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

/** Paths whose existence check passed. A failed or throwing check (lost grant) hides the entry; settings keep it. */
function useExisting(paths: string[], exists: Props["exists"]) {
  const [ok, setOk] = useState<Set<string>>(new Set());
  const key = paths.join("\n"); // re-check when the list changes, not on every new array
  useEffect(() => {
    let live = true;
    void Promise.all(paths.map((p) => exists(p).catch(() => false))).then((r) => {
      if (live) setOk(new Set(paths.filter((_, i) => r[i])));
    });
    return () => { live = false; };
  }, [key, exists]);
  return ok;
}

type Recent = { kind: "folder" | "file"; path: string; open(): void };

/** VS Code-style start page: title, Start actions, one Recent list (folders, then files). */
export function Welcome({ folder, folders, files, exists, on }: Props) {
  const ok = useExisting([...folders, ...files.map((f) => f.path)], exists);
  const [all, setAll] = useState(false);
  const recent: Recent[] = [
    ...folders.filter((p) => ok.has(p)).map((p) => ({ kind: "folder" as const, path: p, open: () => on.openFolder(p) })),
    ...files.filter((f) => ok.has(f.path)).map((f) => ({ kind: "file" as const, path: f.path, open: () => on.openFile(f) })),
  ];
  const shown = all ? recent : recent.slice(0, SHOWN);

  return (
    <div id="welcome" className="flex-1 overflow-auto">
      <div className="flex max-w-2xl flex-col gap-8 px-12 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">md-reader</h1>
          <p className="text-xl text-muted-foreground">Read and edit Markdown</p>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Start</h2>
          <ul data-start className="flex flex-col gap-0.5">
            <li className="flex items-center gap-3">
              <Link onClick={on.pickFolder}><FolderOpen aria-hidden className="size-5" /> Open Folder…</Link>
              <kbd className="font-sans text-xs text-muted-foreground">{shortcut}</kbd>
            </li>
            {folder && <li><Link onClick={on.newFile}><FilePlus aria-hidden className="size-5" /> New File…</Link></li>}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Recent</h2>
          {recent.length ? (
            <ul className="flex flex-col">
              {shown.map((r) => <Row key={r.path} item={r} onRemove={() => on.remove(r.path)} />)}
              {!all && recent.length > SHOWN && <li><Link onClick={() => setAll(true)}>More…</Link></li>}
            </ul>
          ) : (
            <p className="text-muted-foreground">Folders and files you open show up here.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Link({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button
      className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1 text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Row({ item, onRemove }: { item: Recent; onRemove(): void }) {
  const name = baseName(item.path);
  return (
    <li
      {...{ [item.kind === "folder" ? "data-recent-folder" : "data-recent-file"]: "" }}
      data-path={item.path}
      className="group -mx-1.5 flex items-center gap-1"
    >
      <button
        className="open flex min-w-0 items-baseline gap-3 rounded px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        title={item.path}
        onClick={item.open}
      >
        <span className="flex-none text-brand group-hover:underline">{name}</span>
        <span className="truncate text-muted-foreground">{tilde(parentOf(item.path))}</span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Remove ${name} from recents`}
        onClick={onRemove}
      >
        <X aria-hidden />
      </Button>
    </li>
  );
}
