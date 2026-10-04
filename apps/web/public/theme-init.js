// Runs before first paint (blocking <script> in index.html): apply the stored appearance so the window never
// flashes the wrong theme. Must match theme.ts: localStorage key "theme", a `.dark` class on <html>.
try {
  var m = localStorage.getItem("theme");
  if (m === "dark" || (m !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
