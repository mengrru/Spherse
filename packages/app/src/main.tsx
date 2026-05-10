import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string | null>;
      startServer: (projectRoot: string) => Promise<number>;
      restoreProjects: () => Promise<Array<{ path: string; name: string; port: number }>>;
      closeProject: (projectRoot: string) => Promise<void>;
      revealInFinder: (projectRoot: string) => Promise<void>;
      setLastActiveProject: (path: string) => Promise<void>;
      getLastActiveProject: () => Promise<string | null>;
    };
  }
}

createRoot(document.getElementById("root")!).render(<App />);
