import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

class Box extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(o: Box) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = this.checked;
    el.className = "md-task";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return el;
  }
  ignoreEvent() { return false; }
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (n) => {
        if (n.name !== "TaskMarker") return;
        const checked = view.state.sliceDoc(n.from + 1, n.to - 1).toLowerCase() === "x";
        b.add(n.from, n.to, Decoration.replace({ widget: new Box(checked, n.from) }));
      },
    });
  }
  return b.finish();
}

export const taskCheckboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = build(u.view); }
  },
  { decorations: (v) => v.decorations },
);
