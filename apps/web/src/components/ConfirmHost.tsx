import { useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Action = { key: string; label: string; variant?: "default" | "outline" | "destructive" };
type Request = { title: string; description?: string; actions: Action[] };

let show: ((r: Request, resolve: (key: string) => void) => void) | null = null;

/** Opens the in-app confirm; resolves with the chosen action's key, or "cancel" (Cancel button / Escape). */
export function ask(r: Request): Promise<string> {
  return new Promise((resolve) => show ? show(r, resolve) : resolve("cancel"));
}

export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const pending = useRef<((key: string) => void) | null>(null);

  useEffect(() => {
    show = (r, resolve) => {
      pending.current?.("cancel");
      pending.current = resolve;
      setReq(r);
      setOpen(true);
    };
    return () => { show = null; };
  }, []);

  // Action clicks also close the dialog (onOpenChange): only the first answer counts.
  const answer = (key: string) => {
    const resolve = pending.current;
    pending.current = null;
    setOpen(false);
    resolve?.(key);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) answer("cancel"); }}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          {req?.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer("cancel")}>Cancel</AlertDialogCancel>
          {req?.actions.map((a) => (
            <AlertDialogAction key={a.key} variant={a.variant} onClick={() => answer(a.key)}>{a.label}</AlertDialogAction>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
