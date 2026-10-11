import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDialogForm } from "./AgentDialogForm";
import type { LoadedAgentData } from "./AgentDialog";
import { renderWithProviders, createTestQueryClient } from "../../test/render";
import { createMockHostBridge } from "../../test/host-bridge";

const getSupportedProviders = vi.fn(async () => ({}));
const getModelSettings = vi.fn(async () => ({
  models: {
    text: { defaultModel: "", providers: {} },
    image: { defaultModel: "", providers: {} },
  },
  customProviders: [],
}));
const listMarketplacePrompts = vi.fn(async () => ({
  schemaVersion: 1,
  generatedAt: "2026-10-11T00:00:00Z",
  language: "zh-cn",
  prompts: [],
}));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({ searchFiles: vi.fn(async () => []) }),
  useGlobalApiClient: () => ({ getSupportedProviders, getModelSettings, listMarketplacePrompts }),
}));

const initial: LoadedAgentData = { raw: "---\nname: Test\n---\n\nprompt", theme: "" };

function renderForm(bridgeKind?: "web") {
  return renderWithProviders(
    <AgentDialogForm
      initial={initial}
      mode="create"
      onSubmit={vi.fn(async () => {})}
      onCancel={vi.fn()}
    />,
    {
      bridge: createMockHostBridge(bridgeKind === "web" ? { kind: "web" } : {}),
      queryClient: createTestQueryClient(),
    },
  );
}

describe("AgentDialogForm", () => {
  beforeEach(() => {
    getSupportedProviders.mockClear();
    getModelSettings.mockClear();
  });

  it("renders model and thinking level config on electron host", () => {
    renderForm();

    expect(screen.getByText("模型")).toBeVisible();
    expect(screen.getByText("思考强度")).toBeVisible();
  });

  it("renders model config on web host and fetches provider state from the server", () => {
    renderForm("web");

    expect(screen.getByText("模型")).toBeVisible();
    expect(screen.getByText("思考强度")).toBeVisible();
  });
});
