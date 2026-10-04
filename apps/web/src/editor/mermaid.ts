import { Prec, StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

type Mermaid = (typeof import("mermaid"))["default"];
let mermaidP: Promise<Mermaid> | null = null;
const loadMermaid = () => (mermaidP ??= import("mermaid").then((m) => m.default));
// The `.dark` class on <html> is theme.ts's; reading the DOM keeps the editor free of app state.
const isDark = () => document.documentElement.classList.contains("dark");
/** Dispatch after the app theme flips: diagrams drawn in the other theme are rebuilt (their SVG colours are baked in). */
export const themeChanged = StateEffect.define<null>();
let seq = 0;

class Diagram extends WidgetType {
  constructor(readonly code: string, readonly dark: boolean) { super(); }
  eq(o: Diagram) { return o.code === this.code && o.dark === this.dark; }
  toDOM() {
    const el = document.createElement("div");
    el.className = "md-mermaid";
    el.textContent = "Rendering diagram…";
    loadMermaid()
      .then((m) => {
        m.initialize({ startOnLoad: false, securityLevel: "strict", theme: this.dark ? "dark" : "default" });
        return m.render(`mmd-${seq++}`, this.code);
      })
      .then(
        ({ svg }) => { el.innerHTML = svg; },
        (e) => { el.textContent = `Mermaid error: ${e?.message ?? e}`; el.classList.add("md-mermaid-error"); },
      );
    return el;
  }
  ignoreEvent() { return false; }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const sel = state.selection.main;
  const dark = isDark();
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name !== "FencedCode") return;
      const info = n.node.getChild("CodeInfo");
      if (!info || state.sliceDoc(info.from, info.to).trim() !== "mermaid") return false;
      if (sel.from <= n.to && sel.to >= n.from) return false; // cursor inside: show source
      const text = n.node.getChild("CodeText");
      const code = text ? state.sliceDoc(text.from, text.to) : "";
      out.push(Decoration.replace({ widget: new Diagram(code, dark), block: true }).range(n.from, n.to));
      return false;
    },
  });
  return Decoration.set(out);
}

export const mermaidBlocks = Prec.highest(
  StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) =>
      (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(themeChanged)) ? build(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  }),
);
