import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string | null>;
      startServer: (projectRoot: string) => Promise<number>;
    };
  }
}

createRoot(document.getElementById("root")!).render(<App />);
