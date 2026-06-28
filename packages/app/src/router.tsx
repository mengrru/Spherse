import { createHashRouter } from "react-router";
import { App } from "./App";
import { ProjectScope } from "./layouts/ProjectScope";
import { ChatPage } from "./pages/ChatPage";
import { ContentBrowserPage } from "./pages/ContentBrowserPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { WelcomePagePage } from "./pages/WelcomePagePage";

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <OnboardingPage />,
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
