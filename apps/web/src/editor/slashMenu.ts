import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as lucideIcons from "lucide-react";
import { filterSlashCommands, matchSlashQuery, SLASH_COMMANDS, type SlashCommand } from "@/core/slashMenu";

// Cache rendered SVG icons to avoid re-rendering
const iconCache = new Map<string, string>();

function getIconSvg(iconName?: string): string {
  if (!iconName) return "";
  let cached = iconCache.get(iconName);
  if (!cached) {
    const IconComponent = (lucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[iconName];
    if (IconComponent) {
      cached = renderToStaticMarkup(createElement(IconComponent, { size: 16, className: "slash-icon" }));
      iconCache.set(iconName, cached);
    } else {
      cached = "";
    }
  }
  return cached;
}

function toCompletion(cmd: SlashCommand): Completion {
  return {
    label: `/${cmd.id}`,
    displayLabel: cmd.label,
    detail: cmd.detail,
    apply: snippet(cmd.snippet),
    boost: 99,
  };
}

// Map from label to command for looking up the icon in addToOptions
const commandByLabel = new Map<string, SlashCommand>();
for (const cmd of SLASH_COMMANDS) {
  commandByLabel.set(`/${cmd.id}`, cmd);
}

export function slashCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  const matched = matchSlashQuery(textBefore);
  if (!matched) return null;

  const slashPos = line.from + matched.fromOffset;
  const filtered = filterSlashCommands(matched.query, SLASH_COMMANDS);

  if (filtered.length === 0) return null;

  return {
    from: slashPos,
    to: context.pos,
    options: filtered.map(toCompletion),
    filter: false, // We've already filtered with custom matching logic
  };
}

const slashTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border) !important",
    backgroundColor: "var(--popover) !important",
    color: "var(--popover-foreground) !important",
    borderRadius: "var(--radius-lg) !important",
    boxShadow: "0 10px 30px -4px rgba(0, 0, 0, 0.16), 0 4px 10px -2px rgba(0, 0, 0, 0.08) !important",
    padding: "6px !important",
    zIndex: "50 !important",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-sans) !important",
    fontSize: "14px !important",
    maxHeight: "340px !important",
    minWidth: "320px !important",
    display: "flex !important",
    flexDirection: "column !important",
    gap: "2px !important",
    margin: "0 !important",
    padding: "0 !important",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "8px 12px !important",
    borderRadius: "var(--radius-md) !important",
    display: "flex !important",
    alignItems: "center !important",
    gap: "12px !important",
    lineHeight: "1.4 !important",
    cursor: "pointer !important",
    transition: "background-color 100ms ease, color 100ms ease !important",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "oklch(from var(--brand) l c h / 14%) !important",
    color: "var(--foreground) !important",
    fontWeight: "500 !important",
  },
  ".cm-slash-icon-wrapper": {
    display: "inline-flex !important",
    alignItems: "center !important",
    justifyContent: "center !important",
    width: "28px !important",
    height: "28px !important",
    flexShrink: "0 !important",
    borderRadius: "var(--radius-sm) !important",
    background: "var(--muted) !important",
    color: "var(--foreground) !important",
    border: "1px solid var(--border) !important",
  },
  ".cm-slash-icon-wrapper svg": {
    width: "16px !important",
    height: "16px !important",
    strokeWidth: "2 !important",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected] .cm-slash-icon-wrapper": {
    background: "var(--background) !important",
    color: "var(--brand) !important",
    borderColor: "oklch(from var(--brand) l c h / 30%) !important",
  },
  ".cm-completionLabel": {
    flex: "1 !important",
    fontWeight: "500 !important",
    color: "var(--foreground) !important",
  },
  ".cm-completionDetail": {
    marginLeft: "auto !important",
    fontSize: "12px !important",
    color: "var(--muted-foreground) !important",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace !important",
    fontStyle: "normal !important",
  },
});

export function slashMenuExtension(isEnabled?: () => boolean): Extension {
  return [
    autocompletion({
      override: [
        (context: CompletionContext) => {
          if (isEnabled && !isEnabled()) return null;
          return slashCompletionSource(context);
        },
      ],
      activateOnTyping: true,
      icons: false, // disable default CodeMirror icons (e.g. key icon for keyword)
      addToOptions: [
        {
          position: 10,
          render: (completion) => {
            const cmd = commandByLabel.get(completion.label);
            if (!cmd?.iconName) return null;
            const svg = getIconSvg(cmd.iconName);
            if (!svg) return null;
            const wrapper = document.createElement("span");
            wrapper.className = "cm-slash-icon-wrapper";
            wrapper.innerHTML = svg;
            return wrapper;
          },
        },
      ],
    }),
    slashTheme,
  ];
}
