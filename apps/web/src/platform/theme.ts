// Appearance: the user's mode (System/Light/Dark) and the light/dark it resolves to.
// index.html applies the stored mode before first paint (same key, same `.dark` class); this keeps it live.
export type Mode = "system" | "light" | "dark";

// ponytail: localStorage, not settings.json, because index.html must read it synchronously; lost if webview data is cleared.
export const THEME_KEY = "theme";
const nextMode: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };

function stored(): Mode {
  try {
    const m = localStorage.getItem(THEME_KEY);
    return m === "light" || m === "dark" ? m : "system";
  } catch {
    return "system";
  }
}

/** `onChange` fires when the mode or the effective theme changes, never for the initial state. */
export function createTheme(onChange: () => void) {
  const os = matchMedia("(prefers-color-scheme: dark)");
  let mode = stored();
  const isDark = () => mode === "dark" || (mode === "system" && os.matches);
  const apply = () => document.documentElement.classList.toggle("dark", isDark());
  os.addEventListener("change", () => {
    if (mode !== "system") return;
    apply();
    onChange();
  });
  apply();
  return {
    get mode() { return mode; },
    cycle() {
      mode = nextMode[mode];
      try { localStorage.setItem(THEME_KEY, mode); } catch { /* private storage: the mode just won't persist */ }
      apply();
      onChange();
    },
  };
}
