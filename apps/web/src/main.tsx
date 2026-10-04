import "./styles.css";
import "katex/dist/katex.min.css";
import { createRoot } from "react-dom/client";
import App from "./App";

// No StrictMode: App creates the editor and the open document exactly once.
createRoot(document.getElementById("root")!).render(<App />);
