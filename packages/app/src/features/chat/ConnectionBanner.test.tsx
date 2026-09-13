import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render";
import { ConnectionBanner } from "./ConnectionBanner";
import type { WsConnectionState } from "../../lib/ws/ws-connection";

function render(state: WsConnectionState, historyError = false) {
  return renderWithProviders(
    <ConnectionBanner
      state={state}
      historyError={historyError}
      onReconnect={() => {}}
      onRetryHistory={() => {}}
    />,
  );
}

describe("ConnectionBanner", () => {
  it("renders nothing while the socket is open", () => {
    const { container } = render("open");
    expect(container.textContent).toBe("");
  });

  it("shows the reconnecting banner while connecting or waiting for backoff", () => {
    render("connecting");
    expect(screen.getByText("连接已断开，正在重连…")).toBeInTheDocument();

    render("waiting-backoff");
    expect(screen.getAllByText("连接已断开，正在重连…")).toHaveLength(2);
  });

  it("shows the manual reconnect banner for failed and fatal states", () => {
    render("failed");
    expect(screen.getByText("连接失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重连" })).toBeInTheDocument();

    render("fatal");
    expect(screen.getAllByText("连接失败")).toHaveLength(2);
  });

  it("prioritizes the history error banner", () => {
    render("failed", true);
    expect(screen.getByText("会话历史加载失败")).toBeInTheDocument();
    expect(screen.queryByText("连接失败")).not.toBeInTheDocument();
  });
});
