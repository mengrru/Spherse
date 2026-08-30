import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import type { Locale } from "@spherse/i18n";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";
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
    let node: ReactNode = children;
    if (wrapper) node = wrapper(node);
    if (queryClient) {
      node = <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
    }
    if (bridge) {
      node = <HostBridgeProvider bridge={bridge}>{node}</HostBridgeProvider>;
    }
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
