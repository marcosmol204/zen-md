export type SlashCommand = {
  id: string;
  label: string;
  detail?: string;
  type?: string;
  iconName?: string;
  keywords: readonly string[];
  snippet: string;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "h1",
    label: "Heading 1",
    detail: "# Big heading",
    iconName: "Heading1",
    keywords: ["h1", "heading", "title", "header"],
    snippet: "# #{1:Heading 1}\n",
  },
  {
    id: "h2",
    label: "Heading 2",
    detail: "## Medium heading",
    iconName: "Heading2",
    keywords: ["h2", "heading", "subtitle", "header"],
    snippet: "## #{1:Heading 2}\n",
  },
  {
    id: "h3",
    label: "Heading 3",
    detail: "### Small heading",
    iconName: "Heading3",
    keywords: ["h3", "heading", "subheading", "header"],
    snippet: "### #{1:Heading 3}\n",
  },
  {
    id: "bullet",
    label: "Bullet List",
    detail: "- Unordered list",
    iconName: "List",
    keywords: ["bullet", "list", "unordered", "ul"],
    snippet: "- #{1:Item}\n",
  },
  {
    id: "number",
    label: "Numbered List",
    detail: "1. Ordered list",
    iconName: "ListOrdered",
    keywords: ["number", "ordered", "list", "ol"],
    snippet: "1. #{1:Item}\n",
  },
  {
    id: "task",
    label: "To-do / Task List",
    detail: "- [ ] Checkbox task",
    iconName: "ListTodo",
    keywords: ["task", "todo", "check", "checkbox", "list"],
    snippet: "- [ ] #{1:Task}\n",
  },
  {
    id: "quote",
    label: "Quote",
    detail: "> Blockquote",
    iconName: "Quote",
    keywords: ["quote", "blockquote", "callout"],
    snippet: "> #{1:Quote}\n",
  },
  {
    id: "code",
    label: "Code Block",
    detail: "``` Code block",
    iconName: "Code",
    keywords: ["code", "codeblock", "pre", "javascript", "typescript", "python"],
    snippet: "```#{1:lang}\n#{2:code}\n```\n",
  },
  {
    id: "table",
    label: "Table",
    detail: "| GFM table |",
    iconName: "Table",
    keywords: ["table", "grid", "rows", "columns"],
    snippet: "| #{1:Header 1} | #{2:Header 2} |\n| --- | --- |\n| #{3:Cell 1} | #{4:Cell 2} |\n",
  },
  {
    id: "divider",
    label: "Divider",
    detail: "--- Horizontal rule",
    iconName: "Minus",
    keywords: ["divider", "horizontal", "rule", "line", "separator", "hr"],
    snippet: "---\n",
  },
  {
    id: "note",
    label: "Note Callout",
    detail: "> [!NOTE]",
    iconName: "Info",
    keywords: ["note", "callout", "alert", "info"],
    snippet: "> [!NOTE]\n> #{1:Information}\n",
  },
  {
    id: "tip",
    label: "Tip Callout",
    detail: "> [!TIP]",
    iconName: "Lightbulb",
    keywords: ["tip", "callout", "alert", "hint", "idea"],
    snippet: "> [!TIP]\n> #{1:Helpful tip}\n",
  },
  {
    id: "warning",
    label: "Warning Callout",
    detail: "> [!WARNING]",
    iconName: "AlertTriangle",
    keywords: ["warning", "callout", "alert", "caution", "danger"],
    snippet: "> [!WARNING]\n> #{1:Warning notice}\n",
  },
  {
    id: "mermaid",
    label: "Mermaid Diagram",
    detail: "```mermaid",
    iconName: "GitBranch",
    keywords: ["mermaid", "diagram", "chart", "flowchart", "graph"],
    snippet: "```mermaid\nflowchart TD\n  #{1:Start} --> #{2:End}\n```\n",
  },
  {
    id: "math",
    label: "Math Block",
    detail: "$$ or ```math",
    iconName: "Sigma",
    keywords: ["math", "latex", "formula", "equation", "katex"],
    snippet: "$$\n#{1:E = mc^2}\n$$\n",
  },
  {
    id: "link",
    label: "Link",
    detail: "[title](url)",
    iconName: "Link",
    keywords: ["link", "url", "href"],
    snippet: "[#{1:text}](#{2:url})",
  },
  {
    id: "image",
    label: "Image",
    detail: "![alt](url)",
    iconName: "Image",
    keywords: ["image", "picture", "photo", "img"],
    snippet: "![#{1:alt}](#{2:url})",
  },
];

/**
 * Check if the text before cursor matches a slash trigger.
 * Matches when `/` is preceded by start-of-line or whitespace.
 * Returns the slash start position (where `/` is) and query after `/`.
 */
export function matchSlashQuery(lineTextBeforeCursor: string): { fromOffset: number; query: string } | null {
  // Look for `/` preceded by line start or whitespace, followed by non-space chars
  const match = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(lineTextBeforeCursor);
  if (!match) return null;
  // Offset of the '/' character relative to the start of lineTextBeforeCursor
  const fromOffset = lineTextBeforeCursor.length - match[1].length - 1;
  return {
    fromOffset,
    query: match[1],
  };
}

/**
 * Filter slash commands by query.
 * Matches if query matches id, label prefix/words, or any keywords.
 */
export function filterSlashCommands(query: string, commands: readonly SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];

  return commands.filter((cmd) => {
    if (cmd.id.toLowerCase().startsWith(q)) return true;
    if (cmd.label.toLowerCase().includes(q)) return true;
    return cmd.keywords.some((kw) => kw.toLowerCase().startsWith(q) || kw.toLowerCase().includes(q));
  });
}
