import { createHashRouter } from "react-router";
import { App } from "./App";
import { EmptyState } from "./components/EmptyState";
import { ProjectScope } from "./layouts/ProjectScope";
import { ChatPage } from "./pages/ChatPage";
import { ContentBrowserPage } from "./pages/ContentBrowserPage";
import { WelcomePagePage } from "./pages/WelcomePagePage";

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
        element: <ProjectScope />,
        children: [
          {
            index: true,
            element: <WelcomePagePage />,
          },
          {
            path: "chat/:sessionId",
            element: <ChatPage />,
          },
          {
            path: "content",
            element: <ContentBrowserPage />,
          },
        ],
      },
    ],
  },
]);
