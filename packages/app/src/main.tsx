import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router";
import "./styles.css";

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string | null>;
      startServer: (projectRoot: string) => Promise<number>;
      restoreProjects: () => Promise<Array<{ path: string; name: string; port: number }>>;
      addOpenProject: (projectRoot: string) => Promise<void>;
      closeProject: (projectRoot: string) => Promise<void>;
      revealInFinder: (projectRoot: string) => Promise<void>;
      setLastActiveProject: (path: string) => Promise<void>;
      getLastActiveProject: () => Promise<string | null>;
    };
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
