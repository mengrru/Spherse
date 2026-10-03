import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDialogForm } from "./AgentDialogForm";
import type { LoadedAgentData } from "./AgentDialog";
import { renderWithProviders, createTestQueryClient } from "../../test/render";
import { createMockHostBridge } from "../../test/host-bridge";

const getSupportedProviders = vi.fn(async () => ({}));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({ getSupportedProviders }),
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
  });

  it("hides model and thinking level config on web host and skips provider fetching", () => {
    renderForm("web");

    expect(screen.queryByText("模型")).toBeNull();
    expect(screen.queryByText("思考强度")).toBeNull();
    expect(getSupportedProviders).not.toHaveBeenCalled();
  });

  it("renders model and thinking level config on electron host", () => {
    renderForm();

    expect(screen.getByText("模型")).toBeVisible();
    expect(screen.getByText("思考强度")).toBeVisible();
  });
});
