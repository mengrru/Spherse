import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// GitHub Pages serves 404.html for unknown paths (e.g. direct access to /cases).
// 404.html stores the intended path here and redirects to "/", so restore it
// before the router mounts.
const REDIRECT_KEY = "spherse-landing-redirect";
try {
  const redirect = sessionStorage.getItem(REDIRECT_KEY);
  if (redirect) {
    sessionStorage.removeItem(REDIRECT_KEY);
    history.replaceState(null, "", redirect);
  }
} catch {
  // sessionStorage unavailable — ignore
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
