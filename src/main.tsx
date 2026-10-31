import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/vazirmatn/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/views.css";
import "./styles/plans.css";
import "./styles/relax.css";
import "./styles/scenes.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
