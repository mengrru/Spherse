import { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { ProjectPage } from "./pages/ProjectPage";
import type { AppContext } from "./lib/context";

export function App() {
  const [ctx, setCtx] = useState<AppContext | null>(null);

  if (!ctx) {
    return <HomePage onProjectReady={setCtx} />;
  }

  return <ProjectPage ctx={ctx} />;
}
