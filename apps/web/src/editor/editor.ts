import { Annotation, Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  blockMathField, codeBlockField, collapseOnSelectionFacet, editorTheme, imageField, linkPlugin,
  livePreviewPlugin, markdownStylePlugin, mathPlugin, mouseSelectingField, setMouseSelecting, tableField,
} from "codemirror-live-markdown";
import { diffRange } from "@/core/text";
import { taskCheckboxes } from "./tasks";
import { mermaidBlocks, themeChanged } from "./mermaid";
import type { EditorPort } from "@/core/doc";

export type ViewMode = "formatted" | "source";
export type EditorHandle = EditorPort & {
  focus(): void; setImageBase(url: string): void; themeChanged(): void; setMode(mode: ViewMode): void;
};

const external = Annotation.define<boolean>();

// codemirror-live-markdown leaves blockquotes unstyled: mark their lines so styles.css can draw the bar.
const quoteLine = Decoration.line({ class: "md-quote" });
function quoteLines(view: EditorView): DecorationSet {
  const lines = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({ from, to, enter(n) {
      if (n.name !== "Blockquote") return;
      for (let l = view.state.doc.lineAt(n.from).number; l <= view.state.doc.lineAt(n.to).number; l++) lines.add(l);
      return false;
    } });
  }
  return Decoration.set([...lines].map((l) => quoteLine.range(view.state.doc.line(l).from)));
}
const quotes = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = quoteLines(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = quoteLines(u.view); }
}, { decorations: (v) => v.decorations });

// Source mode: light colouring from the editor's theme variables, so it follows light/dark.
const sourceStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "hsl(var(--md-heading))" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "hsl(var(--md-link))" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.quote, tags.monospace], color: "hsl(var(--muted-foreground))" },
]);

export function createEditor(parent: HTMLElement, opts: { onUserEdit(): void }): EditorHandle {
  const readOnly = new Compartment();
  const images = new Compartment();
  const mode = new Compartment();
  let viewMode: ViewMode = "formatted";
  let imageExt = imageField();
  // Everything that renders markdown instead of showing it; Source mode swaps it all out at once.
  const formatted = (): Extension => [
    collapseOnSelectionFacet.of(true),
    livePreviewPlugin,
    markdownStylePlugin,
    editorTheme,
    mathPlugin,
    blockMathField,
    tableField,
    mermaidBlocks,
    codeBlockField({ copyButton: true }),
    images.of(imageExt),
    linkPlugin(),
    taskCheckboxes,
    quotes,
  ];
  const source: Extension = [syntaxHighlighting(sourceStyle), EditorView.contentAttributes.of({ class: "md-source" })];
  const modeExt = () => (viewMode === "formatted" ? formatted() : source);
  const extensions = (): Extension[] => [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage }), // markdownLanguage = CommonMark + GFM (tables, task lists, strikethrough)
    mouseSelectingField, // outside `mode` so the mouse listeners below can always dispatch to it
    mode.of(modeExt()),
    readOnly.of(EditorState.readOnly.of(true)),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) opts.onUserEdit();
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions: extensions() }) });
  view.contentDOM.addEventListener("mousedown", () => view.dispatch({ effects: setMouseSelecting.of(true) }));
  document.addEventListener("mouseup", () =>
    requestAnimationFrame(() => view.dispatch({ effects: setMouseSelecting.of(false) })));

  return {
    getText: () => view.state.doc.toString(),
    load(text) {
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
      view.scrollDOM.scrollTop = 0;
    },
    applyExternal(text) {
      const change = diffRange(view.state.doc.toString(), text);
      if (!change) return;
      const sd = view.scrollDOM;
      const atBottom = sd.scrollHeight - sd.scrollTop - sd.clientHeight < 4;
      view.dispatch({ changes: change, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
      if (atBottom) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: "end" }) });
    },
    setReadOnly(ro) {
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(ro)) });
    },
    setImageBase(url) {
      imageExt = imageField({ basePath: url });
      if (viewMode === "formatted") view.dispatch({ effects: images.reconfigure(imageExt) });
    },
    setMode(next) {
      if (next === viewMode) return;
      viewMode = next;
      // CodeMirror's own scroll anchoring keeps the top visible line in place (e2e covers it).
      view.dispatch({ effects: mode.reconfigure(modeExt()) });
    },
    focus: () => view.focus(),
    themeChanged: () => view.dispatch({ effects: themeChanged.of(null) }),
  };
}
