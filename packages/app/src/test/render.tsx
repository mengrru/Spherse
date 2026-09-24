import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import type { Locale } from "@spherse/i18n";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router";
import { HostBridgeProvider } from "../context/host-bridge-context";
import { ProjectProvider } from "../context/project-context";
import type { HostBridge } from "../lib/host-bridge";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  projectId?: string;
  projectRoot?: string;
  route?: string;
  queryClient?: QueryClient;
  bridge?: HostBridge;
  locale?: Locale;
  wrapper?: (node: ReactNode) => ReactNode;
}

export interface RenderWithDataRouterOptions extends RenderWithProvidersOptions {
  routePath: string;
  extraRoutes?: { path: string; element: ReactNode }[];
}

function wrapProviders(
  node: ReactNode,
  { wrapper, queryClient, bridge }: Pick<RenderWithProvidersOptions, "wrapper" | "queryClient" | "bridge">,
): ReactNode {
  let result = node;
  if (wrapper) result = wrapper(result);
  if (queryClient) result = <QueryClientProvider client={queryClient}>{result}</QueryClientProvider>;
  if (bridge) result = <HostBridgeProvider bridge={bridge}>{result}</HostBridgeProvider>;
  return result;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  const {
    projectId = "p1",
    projectRoot = "/tmp/p1",
    route = "/",
    queryClient,
    bridge,
    locale = "zh-CN",
    wrapper,
    ...renderOptions
  } = options;

  function ProviderTree({ children }: { children: ReactNode }) {
    const node = wrapProviders(children, { wrapper, queryClient, bridge });
    return (
      <I18nProvider locale={locale}>
        <MemoryRouter initialEntries={[route]}>
          <ProjectProvider projectId={projectId} projectRoot={projectRoot}>
            {node}
          </ProjectProvider>
        </MemoryRouter>
      </I18nProvider>
    );
  }

  return render(ui, { wrapper: ProviderTree, ...renderOptions });
}

export function renderWithDataRouter(ui: ReactElement, options: RenderWithDataRouterOptions) {
  const {
    projectId = "p1",
    projectRoot = "/tmp/p1",
    route = "/",
    queryClient,
    bridge,
    locale = "zh-CN",
    wrapper,
    routePath,
    extraRoutes = [],
    ...renderOptions
  } = options;
  const withProject = (node: ReactNode) => (
    <ProjectProvider projectId={projectId} projectRoot={projectRoot}>{node}</ProjectProvider>
  );
  const router = createMemoryRouter(
    [
      { path: routePath, element: withProject(ui) },
      ...extraRoutes.map((r) => ({ path: r.path, element: withProject(r.element) })),
    ],
    { initialEntries: [route] },
  );
  const result = render(
    <I18nProvider locale={locale}>
      {wrapProviders(<RouterProvider router={router} />, { wrapper, queryClient, bridge })}
    </I18nProvider>,
    renderOptions,
  );
  return { ...result, router };
}
