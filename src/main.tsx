import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/vazirmatn/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isTauri } from "./persistence/driver";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/views.css";
import "./styles/plans.css";
import "./styles/relax.css";
import "./styles/scenes.css";
import "./styles/phone.css";

if (!isTauri() && import.meta.env.PROD) {
  // Offline support, and a request that the browser keeps this site's data rather than clearing it when space runs low.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js").catch(() => undefined));
  }
  void navigator.storage?.persist?.().catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
