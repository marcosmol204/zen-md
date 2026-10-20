// Preview mode: markdown rendered, markup never shown, strictly read-only.
// Text and code blocks remain selectable and copyable; editing happens only in Source (edit) mode.

import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { highlightCode } from "codemirror-live-markdown";
import { htmlTokens, type Token } from "@/core/highlight";
import { isDelimiterRow, plainCell, rowCells } from "@/core/table";
import { toggleTaskMarker } from "@/core/text";

const hide = (widget?: WidgetType, fence = false) => Decoration.replace({ widget, fence });

// Formatted inline nodes: the text between their first and closing mark shows, the marks hide.
const SPANS = new Map([
  ["Emphasis", "EmphasisMark"], ["StrongEmphasis", "EmphasisMark"], ["Strikethrough", "StrikethroughMark"],
  ["InlineCode", "CodeMark"], ["Link", "LinkMark"], ["Autolink", "LinkMark"],
]);
// Marks that open a line: hidden together with the whitespace after them.
const PREFIX_MARKS = new Set(["HeaderMark", "QuoteMark", "ListMark", "TaskMarker"]);

type Prefix = { end: number; marks: { name: string; from: number; to: number }[]; depth: number };

function build(state: EditorState): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const prefixes = new Map<number, Prefix>();
  const skipSpaces = (pos: number, limit: number) => {
    while (pos < limit && /[ \t]/.test(doc.sliceString(pos, pos + 1))) pos++;
    return pos;
  };

  syntaxTree(state).iterate({
    enter: (n) => {
      const name = n.name;
      if (name === "Image") return false; // the image widget replaces it whole
      if (name === "FencedCode" || name === "CodeBlock") {
        const info = n.node.getChild("CodeInfo");
        const lang = info ? doc.sliceString(info.from, info.to).trim() : "";
        if (lang === "mermaid" || lang === "math") return false; // drawn by mermaid.ts / the math plugin
        const first = doc.lineAt(n.from).number;
        const last = doc.lineAt(n.to).number;
        for (let l = first; l <= last; l++) {
          const cls = `md-code-line${l === first ? " md-code-first" : ""}${l === last ? " md-code-last" : ""}`;
          out.push(Decoration.line({ class: cls }).range(doc.line(l).from));
        }
        const codeTextNode = n.node.getChild("CodeText");
        const rawCode = codeTextNode ? doc.sliceString(codeTextNode.from, codeTextNode.to) : "";
        // Fence lines (``` + language) hide; their lines stay as the code box's top and bottom padding.
        const marks = n.node.getChildren("CodeMark");
        marks.forEach((mark, idx) => {
          const line = doc.lineAt(mark.from);
          if (mark.from < line.to) {
            const widget = idx === 0 && name === "FencedCode" ? new CopyCodeWidget(rawCode) : undefined;
            out.push(hide(widget, true).range(mark.from, line.to));
          }
        });
        return; // inside a quote the code lines still carry "> " prefixes, hidden below
      }
      if (name === "Table") {
        const start = doc.lineAt(n.from);
        const end = doc.lineAt(n.to);
        // A block widget must span whole lines; a table inside a quote or list stays as text.
        if (start.from === n.from && end.to === n.to) {
          out.push(Decoration.replace({ widget: new TableWidget(tableModel(state, n.from, n.to)), block: true }).range(n.from, n.to));
        }
        return false;
      }
      if (name === "HorizontalRule") {
        out.push(hide(new RuleWidget()).range(n.from, n.to));
        return false;
      }
      if (name === "Escape") {
        out.push(hide().range(n.from, n.from + 1));
        return false;
      }
      if (SPANS.has(name)) {
        const text = doc.sliceString(n.from, n.to);
        if (name === "InlineCode" && text.startsWith("`$") && text.endsWith("$`")) return false; // inline math
        const marks = n.node.getChildren(SPANS.get(name)!);
        if (marks.length < 2) return;
        const content = { from: marks[0].to, to: (name === "Link" ? marks[1] : marks[marks.length - 1]).from };
        if (n.from < content.from) out.push(hide().range(n.from, content.from));
        if (name === "Link" && content.from < content.to) {
          const urlNode = n.node.getChild("URL");
          const href = urlNode ? doc.sliceString(urlNode.from, urlNode.to).trim() : "";
          if (href) {
            out.push(Decoration.mark({ class: "md-link", attributes: { "data-href": href } }).range(content.from, content.to));
          }
        }
        if (content.to < n.to) out.push(hide().range(content.to, n.to));
        return;
      }
      if (name === "SetextHeading1" || name === "SetextHeading2") {
        const mark = n.node.getChild("HeaderMark");
        if (mark) out.push(hide().range(mark.from, mark.to));
        return;
      }
      if (PREFIX_MARKS.has(name)) {
        const line = doc.lineAt(n.from);
        const p = prefixes.get(line.from) ?? { end: line.from, marks: [], depth: 0 };
        if (doc.sliceString(p.end, n.from).trim() === "") {
          p.marks.push({ name, from: n.from, to: n.to });
          p.end = skipSpaces(n.to, line.to);
          if (name === "ListMark") p.depth = listDepth(n.node);
          prefixes.set(line.from, p);
        } else if (name === "HeaderMark") {
          // A closing "##" of an ATX heading, with the spaces before it.
          let from = n.from;
          while (from > line.from && /[ \t]/.test(doc.sliceString(from - 1, from))) from--;
          out.push(hide().range(from, n.to));
        }
      }
    },
  });

  for (const [from, p] of prefixes) {
    if (!p.marks.length) continue;
    const task = p.marks.find((m) => m.name === "TaskMarker");
    const list = [...p.marks].reverse().find((m) => m.name === "ListMark");
    let widget: WidgetType | undefined;
    if (task) {
      widget = new Bullet(p.depth, {
        checked: /x/i.test(doc.sliceString(task.from, task.to)),
        from: task.from,
        to: task.to,
      });
    } else if (list) {
      const mark = doc.sliceString(list.from, list.to);
      widget = new Bullet(p.depth, /\d/.test(mark) ? mark : "•");
    }
    out.push(hide(widget).range(from, p.end));
  }
  return Decoration.set(out, true);
}

type TreeNode = { name: string; parent: TreeNode | null };
function listDepth(node: TreeNode): number {
  let depth = -1;
  for (let p: TreeNode | null = node; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
  return Math.max(0, depth);
}

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

class CopyCodeWidget extends WidgetType {
  constructor(readonly code: string) { super(); }
  eq(o: CopyCodeWidget) { return o.code === this.code; }
  toDOM() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-code-copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.title = "Copy code";
    btn.dataset.code = this.code;
    btn.innerHTML = COPY_SVG;
    return btn;
  }
  ignoreEvent() { return false; }
}

/** The list marker (bullet, number or interactive checkbox) that stands in for a hidden list prefix. */
class Bullet extends WidgetType {
  constructor(
    readonly depth: number,
    readonly mark: string | { checked: boolean; from: number; to: number },
  ) {
    super();
  }
  eq(o: Bullet) {
    return o.depth === this.depth && (typeof o.mark === "string" || typeof this.mark === "string"
      ? o.mark === this.mark
      : o.mark.checked === this.mark.checked && o.mark.from === this.mark.from && o.mark.to === this.mark.to);
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "md-bullet";
    wrap.style.paddingLeft = `${this.depth * 1.5}em`;
    const mark = this.mark;
    if (typeof mark === "string") {
      const b = document.createElement("span");
      b.className = mark === "•" ? "md-bullet-dot" : "md-bullet-num";
      b.textContent = mark;
      wrap.append(b);
      return wrap;
    }
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = mark.checked;
    box.dataset.taskFrom = String(mark.from);
    box.dataset.taskTo = String(mark.to);
    box.className = "md-task";
    wrap.append(box);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "md-rule";
    return el;
  }
}

type TableModel = { align: (string | null)[]; rows: string[][] };

function tableModel(state: EditorState, from: number, to: number): TableModel {
  const lines: string[] = [];
  for (let pos = from; pos <= to; ) {
    const line = state.doc.lineAt(pos);
    lines.push(line.text);
    pos = line.to + 1;
  }
  const delim = lines.findIndex(isDelimiterRow);
  const align = delim < 0 ? [] : rowCells(lines[delim]).map(({ text: t }) =>
    t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : t.startsWith(":") ? "left" : null);
  return { align, rows: lines.filter((_, i) => i !== delim).map((l) => rowCells(l).map((c) => c.text)) };
}

class TableWidget extends WidgetType {
  constructor(readonly model: TableModel) { super(); }
  eq(o: TableWidget) { return JSON.stringify(o.model) === JSON.stringify(this.model); }
  toText() {
    return this.model.rows.map((r) => r.map((c) => plainCell(c) ?? c).join("\t")).join("\n");
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-table-widget md-table";
    wrap.contentEditable = "false";
    const table = document.createElement("table");
    const cols = this.model.rows[0]?.length ?? 0;
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement(r === 0 ? "th" : "td");
        const text = row[c] ?? "";
        const align = this.model.align[c];
        if (align) cell.style.textAlign = align;
        const plain = plainCell(text);
        if (plain === null) renderInline(cell, text);
        else cell.textContent = plain;
        tr.append(cell);
      }
      (r === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody())).append(tr);
    });
    wrap.append(table);
    return wrap;
  }
  ignoreEvent() { return true; }
}

/** Read-only rendering of a cell that holds markup: bold, italic, strike, code, links. */
function renderInline(el: HTMLElement, text: string) {
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|~~(.+?)~~|`([^`]+)`|!?\[([^\]]*)\]\(([^)]*)\)|\\(.)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    el.append(text.slice(last, m.index));
    const [tag, inner] = m[2] != null ? ["strong", m[2]] : m[4] != null ? ["em", m[4]] : m[5] != null ? ["s", m[5]]
      : m[6] != null ? ["code", m[6]] : m[7] != null ? ["span", m[7]] : ["", m[9]];
    if (!tag) el.append(inner);
    else {
      const child = document.createElement(tag);
      if (tag === "code") child.className = "cm-code";
      if (tag === "span") {
        child.className = "cm-link md-link";
        if (m[8] && !m[0].startsWith("!")) child.dataset.href = m[8].trim();
      }
      if (tag === "code") child.textContent = inner;
      else renderInline(child, inner);
      el.append(child);
    }
    last = m.index + m[0].length;
  }
  el.append(text.slice(last));
}

const previewField = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) => (tr.docChanged || tr.reconfigured || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? build(tr.state) : deco),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))],
});

/** Extracts visible rendered text for `[from, to]` in Preview, stripping hidden markdown delimiters. */
function sliceVisible(state: EditorState, from: number, to: number): string {
  const deco = state.field(previewField, false);
  if (!deco) return state.sliceDoc(from, to);
  let out = "";
  let pos = from;
  deco.between(from, to, (f, t, d) => {
    if (!d.point || f === t) return;
    let rf = Math.max(from, f);
    let rt = Math.min(to, t);
    if (d.spec.fence) {
      if (rt < to && state.sliceDoc(rt, rt + 1) === "\n") rt++;
      else if (rf > from && state.sliceDoc(rf - 1, rf) === "\n") rf--;
    }
    if (rf > pos) out += state.sliceDoc(pos, rf);
    if (d.spec.widget instanceof TableWidget) out += d.spec.widget.toText();
    pos = Math.max(pos, rt);
  });
  if (pos < to) out += state.sliceDoc(pos, to);
  return out;
}

function copyFromPreview(view: EditorView): string | null {
  const ranges = view.state.selection.ranges.filter((r) => !r.empty);
  if (ranges.length > 0) {
    return ranges.map((r) => sliceVisible(view.state, r.from, r.to)).join("\n");
  }
  const domSel = window.getSelection()?.toString() ?? "";
  return domSel || null;
}

// Code blocks in Preview are styled lines; colour them with the library's highlighter (same hljs classes).
const tokenCache = new Map<string, Token[]>();
function codeTokens(lang: string, code: string): Token[] {
  const key = `${lang}\0${code}`;
  let tokens = tokenCache.get(key);
  if (!tokens) {
    if (tokenCache.size > 200) tokenCache.clear();
    tokens = htmlTokens(highlightCode(code, lang).html);
    tokenCache.set(key, tokens);
  }
  return tokens;
}

function highlightMarks(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({ from, to, enter: (n) => {
      if (n.name !== "FencedCode") return;
      const info = n.node.getChild("CodeInfo");
      const text = n.node.getChild("CodeText");
      const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
      if (!lang || !text || lang === "mermaid" || lang === "math") return false;
      for (const t of codeTokens(lang, state.sliceDoc(text.from, text.to))) {
        out.push(Decoration.mark({ class: t.cls }).range(text.from + t.from, text.from + t.to));
      }
      return false;
    } });
  }
  return Decoration.set(out, true);
}

const codeHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = highlightMarks(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = highlightMarks(u.view);
  }
}, { decorations: (v) => v.decorations });

const previewCopy = EditorView.domEventHandlers({
  copy(event, view) {
    const text = copyFromPreview(view);
    if (text === null || !event.clipboardData) return false;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    return true;
  },
});

export type PreviewOptions = {
  onLinkClick?(href: string): void;
  onCopyCode?(code: string): void;
  canToggleTask?(): boolean;
};

export function preview(opts?: PreviewOptions): Extension {
  const previewEvents = EditorView.domEventHandlers({
    click(event, view) {
      const el = event.target instanceof Element ? event.target : null;
      if (!el) return false;

      const copyBtn = el.closest<HTMLButtonElement>("button.md-code-copy");
      if (copyBtn) {
        event.preventDefault();
        const code = copyBtn.dataset.code ?? "";
        opts?.onCopyCode?.(code);
        copyBtn.dataset.copied = "true";
        copyBtn.setAttribute("aria-label", "Copied");
        copyBtn.innerHTML = CHECK_SVG;
        window.setTimeout(() => {
          if (copyBtn.isConnected) {
            delete copyBtn.dataset.copied;
            copyBtn.setAttribute("aria-label", "Copy code");
            copyBtn.innerHTML = COPY_SVG;
          }
        }, 1500);
        return true;
      }

      const taskBox = el.closest<HTMLInputElement>("input.md-task");
      if (taskBox) {
        event.preventDefault();
        if (opts?.canToggleTask && !opts.canToggleTask()) return true;
        const from = Number(taskBox.dataset.taskFrom);
        const to = Number(taskBox.dataset.taskTo);
        if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to <= view.state.doc.length) {
          const next = toggleTaskMarker(view.state.sliceDoc(from, to));
          view.dispatch({ changes: { from, to, insert: next } });
        }
        return true;
      }

      if (opts?.onLinkClick) {
        const link = el.closest<HTMLElement>("[data-href]");
        const href = link?.dataset.href;
        if (href) {
          event.preventDefault();
          opts.onLinkClick(href);
          return true;
        }
      }

      return false;
    },
  });
  return [previewField, codeHighlight, previewCopy, previewEvents];
}
