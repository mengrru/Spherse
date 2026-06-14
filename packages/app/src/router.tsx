import { createHashRouter } from "react-router";
import { App } from "./App";
import { EmptyState } from "./components/EmptyState";
import { ProjectPage } from "./pages/ProjectPage";

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <EmptyState />,
      },
      {
        path: "project/:projectId",
        element: <ProjectPage />,
      },
      {
        path: "project/:projectId/chat/:sessionId",
        element: <ProjectPage />,
      },
      {
        path: "project/:projectId/content",
        element: <ProjectPage />,
      },
    ],
  },
]);
