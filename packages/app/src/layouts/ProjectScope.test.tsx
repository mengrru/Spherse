import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import { RouterProvider, createMemoryRouter, useLocation } from "react-router";
import { HostBridgeProvider } from "../context/host-bridge-context";
import { createMockHostBridge } from "../test/host-bridge";
import { useAppStore } from "../stores/app-store";
import { ProjectScope } from "./ProjectScope";

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function setup(bridge = createMockHostBridge({ kind: "web" })) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/", element: <LocationProbe /> },
      {
        path: "/project/:projectId",
        element: <ProjectScope />,
        children: [{ index: true, element: <LocationProbe /> }],
      },
    ],
    { initialEntries: ["/project/missing"] },
  );
  render(
    <I18nProvider locale="en">
      <HostBridgeProvider bridge={bridge}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </HostBridgeProvider>
    </I18nProvider>,
  );
  return { router };
}

describe("ProjectScope not-found fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      connection: { baseUrl: "", accessToken: null },
      projects: new Map(),
      activeProjectId: null,
      initializing: false,
    });
  });

  it("shows a back-to-connect button on web and navigates to the connect page", async () => {
    setup();
    expect(screen.getByText("Project not found")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to connect page" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("does not show the back-to-connect button on desktop", () => {
    setup(createMockHostBridge());
    expect(screen.getByText("Project not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to connect page" })).toBeNull();
  });

  it("does not show the button while initializing", () => {
    useAppStore.setState({ initializing: true });
    setup();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to connect page" })).toBeNull();
  });
});
