import { useLayoutEffect, useRef } from "react";

/** Hosts the CodeMirror element App created once; React only moves it into place, never re-creates it. */
export function Editor({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current!.append(el); }, [el]);
  return <div ref={ref} id="editor" className="min-h-0 flex-1" />;
}
