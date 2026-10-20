import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { blockMathField, editorTheme, imageField, markdownStylePlugin, mathPlugin } from "codemirror-live-markdown";
import { diffRange } from "@/core/text";
import type { Match } from "@/core/search";
import { preview } from "./preview";
import { mermaidBlocks, themeChanged } from "./mermaid";
import type { EditorPort } from "@/core/doc";

export type ViewMode = "formatted" | "source";
export type EditorHandle = EditorPort & {
  focus(): void;
  setImageBase(url: string): void;
  themeChanged(): void;
  setMode(mode: ViewMode): void;
  getSelectionStart(): number;
  setSearchHighlights(matches: readonly Match[], activeIndex: number, scroll?: boolean): void;
};

const external = Annotation.define<boolean>();

type SearchHighlightState = { matches: readonly Match[]; active: number };
const setSearch = StateEffect.define<SearchHighlightState>();
const matchMark = Decoration.mark({ class: "cm-search-match" });
const activeMatchMark = Decoration.mark({ class: "cm-search-match cm-search-match-selected" });

const searchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearch)) {
        const { matches, active } = e.value;
        return Decoration.set(
          matches
            .filter((m) => m.from < m.to && m.to <= tr.state.doc.length)
            .map((m, i) => (i === active ? activeMatchMark : matchMark).range(m.from, m.to)),
        );
      }
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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

const sourceCopy = EditorView.domEventHandlers({
  copy(event, view) {
    const ranges = view.state.selection.ranges.filter((r) => !r.empty);
    if (!ranges.length || !event.clipboardData) return false;
    event.preventDefault();
    event.clipboardData.setData("text/plain", ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join("\n"));
    return true;
  },
});

const blockReadOnlyUserEdits = EditorState.transactionFilter.of((tr) =>
  tr.docChanged && tr.startState.readOnly && tr.annotation(Transaction.userEvent) ? [] : tr,
);

export function createEditor(parent: HTMLElement, opts: { onUserEdit(): void; onDocChange?(): void }): EditorHandle {
  const readOnly = new Compartment();
  const images = new Compartment();
  const mode = new Compartment();
  let viewMode: ViewMode = "formatted";
  let docReadOnly = true;
  let imageExt = imageField();
  const isReadOnly = () => docReadOnly || viewMode === "formatted";

  // Preview (formatted): markdown rendered, markup hidden, strictly read-only.
  // Source (edit) mode: raw markdown with syntax colouring, editable when doc is not read-only.
  const formatted = (): Extension => [
    preview(),
    markdownStylePlugin,
    editorTheme,
    mathPlugin,
    blockMathField,
    mermaidBlocks,
    images.of(imageExt),
    quotes,
  ];
  const source: Extension = [
    syntaxHighlighting(sourceStyle),
    EditorView.contentAttributes.of({ class: "md-source" }),
    sourceCopy,
  ];
  const modeExt = () => (viewMode === "formatted" ? formatted() : source);
  const extensions = (): Extension[] => [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage }), // markdownLanguage = CommonMark + GFM (tables, task lists, strikethrough)
    searchField,
    mode.of(modeExt()),
    readOnly.of(EditorState.readOnly.of(isReadOnly())),
    blockReadOnlyUserEdits,
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (!u.transactions.some((t) => t.annotation(external))) opts.onUserEdit();
      opts.onDocChange?.();
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions: extensions() }) });

  return {
    getText: () => view.state.doc.toString(),
    load(text) {
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
      view.scrollDOM.scrollTop = 0;
      opts.onDocChange?.();
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
      docReadOnly = ro;
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(isReadOnly())) });
    },
    setImageBase(url) {
      imageExt = imageField({ basePath: url });
      if (viewMode === "formatted") view.dispatch({ effects: images.reconfigure(imageExt) });
    },
    setMode(next) {
      if (next === viewMode) return;
      viewMode = next;
      // CodeMirror's own scroll anchoring keeps the top visible line in place (e2e covers it).
      view.dispatch({
        effects: [
          mode.reconfigure(modeExt()),
          readOnly.reconfigure(EditorState.readOnly.of(isReadOnly())),
        ],
      });
    },
    getSelectionStart: () => view.state.selection.main.from,
    setSearchHighlights(matches, activeIndex, scroll = false) {
      const effects: StateEffect<unknown>[] = [setSearch.of({ matches, active: activeIndex })];
      if (scroll && activeIndex >= 0 && activeIndex < matches.length) {
        effects.push(EditorView.scrollIntoView(matches[activeIndex].from, { y: "center" }));
      }
      view.dispatch({ effects });
    },
    focus: () => view.focus(),
    themeChanged: () => view.dispatch({ effects: themeChanged.of(null) }),
  };
}
