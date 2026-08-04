/*
 * Entry point.
 *
 * The four global stylesheets are imported here, before `App`, so the cascade
 * order is deterministic in the built bundle: tokens (custom properties) →
 * base (reset, fonts, behaviour classes) → components (shared UI) → screens
 * (view-specific rules, which therefore always win a tie).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";

import { I18nProvider } from "./i18n/index.tsx";
import App from "./app/App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root — check index.html");

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
