import { CircleX, Info, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Banner as BannerState } from "@/core/doc";

export type BannerActions = Record<"reload" | "copy" | "keep" | "recreate" | "close" | "dismiss", () => void>;
type Key = keyof BannerActions;

const SPEC: Record<"changed" | "deleted" | "readonly", { text: string; buttons: [string, Key][] }> = {
  changed: { text: "File changed on disk.", buttons: [["Reload", "reload"], ["Save mine as copy", "copy"], ["Keep mine", "keep"]] },
  deleted: { text: "File deleted on disk.", buttons: [["Save to recreate", "recreate"], ["Close", "close"]] },
  readonly: { text: "Not valid UTF-8, opened read-only.", buttons: [["Dismiss", "dismiss"]] },
};

export function Banner({ banner, actions }: { banner: BannerState; actions: BannerActions }) {
  if (!banner) return null;
  const { text, buttons } = banner.kind === "error"
    ? { text: `Couldn't save: ${banner.message}`, buttons: [["Dismiss", "dismiss"]] as [string, Key][] }
    : SPEC[banner.kind];
  const Icon = banner.kind === "error" ? CircleX : banner.kind === "readonly" ? Info : TriangleAlert;
  return (
    <div
      id="banner"
      role="alert"
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2 text-[13px]",
        banner.kind === "error" ? "border-destructive/40 bg-destructive/10" : banner.kind === "readonly" ? "bg-muted" : "border-warn-border bg-warn",
      )}
    >
      <Icon aria-hidden className={cn("size-4 flex-none", banner.kind === "error" ? "text-destructive" : "text-foreground/70")} />
      <span className="flex-1 font-medium">{text}</span>
      {buttons.map(([label, key]) => (
        <Button key={key} variant="outline" size="xs" className="bg-background" onClick={() => actions[key]()}>{label}</Button>
      ))}
    </div>
  );
}
