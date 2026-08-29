import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { ModelProviderItem } from "./ModelProviderItem";
import type { ProviderConfig } from "./types";

function renderProviderItem(
  config: Partial<ProviderConfig> & { custom?: boolean; keyless?: boolean },
  props: { apiKey?: string; onEdit?: () => void; onDelete?: () => void } = {},
) {
  const onApiKeyCommit = vi.fn();
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();

  function Harness() {
    const [apiKey, setApiKey] = useState(props.apiKey ?? "");
    return (
      <ModelProviderItem
        id="provider-x"
        config={{ name: "Provider X", ...config } as ProviderConfig}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        onApiKeyCommit={onApiKeyCommit}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    );
  }

  renderWithProviders(<Harness />);
  return { onApiKeyCommit, onConnect, onDisconnect };
}

describe("ModelProviderItem custom rows", () => {
  it("renders the Custom badge and baseUrl subtitle, with edit/delete wired to callbacks", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderProviderItem({ custom: true, baseUrl: "https://api.example" }, { onEdit, onDelete });

    expect(screen.getByText("自定义")).toBeInTheDocument();
    expect(screen.getByText("https://api.example")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("hides edit/delete buttons when their callbacks are undefined", () => {
    renderProviderItem({ custom: true, baseUrl: "https://api.example" });
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });
});

describe("ModelProviderItem keyless rows", () => {
  it("renders the keyless badge and omits the api-key input and connect/disconnect", () => {
    renderProviderItem({ keyless: true });
    expect(screen.getByText("无需 API Key")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("API密钥")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "断开连接" })).not.toBeInTheDocument();
  });
});

describe("ModelProviderItem keyed rows", () => {
  it("shows a disabled connect button while no api key is set", () => {
    renderProviderItem({});
    expect(screen.getByRole("button", { name: "连接" })).toBeDisabled();
  });

  it("marks the row connected once a key is typed, commits on blur and disconnects on click", async () => {
    const user = userEvent.setup();
    const { onApiKeyCommit, onDisconnect } = renderProviderItem({});

    await user.type(screen.getByPlaceholderText("API密钥"), "new-key");
    expect(screen.getByText("已连接")).toBeInTheDocument();

    await user.tab();
    expect(onApiKeyCommit).toHaveBeenCalledWith("new-key");

    await user.click(screen.getByRole("button", { name: /断开连接/ }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("shows connected with a stored key and commits a replaced key on blur", async () => {
    const user = userEvent.setup();
    const { onApiKeyCommit } = renderProviderItem({}, { apiKey: "stored-key" });

    expect(screen.getByText("已连接")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("API密钥");
    await user.clear(input);
    await user.type(input, "new-key");
    await user.tab();
    expect(onApiKeyCommit).toHaveBeenCalledWith("new-key");
  });
});
