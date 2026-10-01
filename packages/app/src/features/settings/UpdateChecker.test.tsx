import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "../../lib/host-bridge";
import { DOWNLOAD_PAGE_URL } from "../../lib/urls";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { UpdateChecker } from "./UpdateChecker";
import { useUpdateChecker } from "./use-update-checker";

vi.mock("./use-update-checker", () => ({
  useUpdateChecker: vi.fn(),
}));

const check = vi.fn();
const acceptDownload = vi.fn();
const dismissUpdate = vi.fn();
const cancelDownload = vi.fn();
const acceptRestart = vi.fn();
const dismissRestart = vi.fn();

function mockHookState(state: Partial<UpdateState>) {
  vi.mocked(useUpdateChecker).mockReturnValue({
    state: { status: "idle", ...state } as UpdateState,
    check,
    acceptDownload,
    dismissUpdate,
    cancelDownload,
    acceptRestart,
    dismissRestart,
  });
}

let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  openExternal = vi.fn(async () => {});
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderUpdateChecker() {
  const bridge = createMockHostBridge({
    openExternal,
    updater: {
      getAppVersion: vi.fn(async () => "1.2.3"),
    } as never,
  });
  renderWithProviders(<UpdateChecker />, { bridge });
}

describe("UpdateChecker", () => {
  it("loads the app version on mount and offers a manual check while idle", async () => {
    mockHookState({ status: "idle" });
    renderUpdateChecker();

    expect(await screen.findByText("v1.2.3")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "检查更新" }));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled checking button while checking", () => {
    mockHookState({ status: "checking" });
    renderUpdateChecker();

    expect(screen.getByRole("button", { name: "检查中..." })).toBeDisabled();
  });

  it("shows a disabled up-to-date button", () => {
    mockHookState({ status: "upToDate" });
    renderUpdateChecker();

    expect(screen.getByRole("button", { name: "已是最新版本" })).toBeDisabled();
  });

  it("offers retry and the download page on check errors", async () => {
    mockHookState({ status: "error" });
    renderUpdateChecker();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(check).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "前往官网下载" }));
    expect(openExternal).toHaveBeenCalledWith(DOWNLOAD_PAGE_URL);
  });

  it("renders a progress bar and cancel while downloading", async () => {
    mockHookState({ status: "downloading", percent: 42 });
    renderUpdateChecker();

    expect(screen.getByText("下载中 42%")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(cancelDownload).toHaveBeenCalledTimes(1);
  });

  it("uses the external download page when a legacy version has no download URL", async () => {
    mockHookState({ status: "available", version: "9.9.9", releaseNotes: "bug fixes" });
    renderUpdateChecker();

    expect(await screen.findByText("发现新版本 v9.9.9")).toBeInTheDocument();
    expect(screen.getByText("更新内容")).toBeInTheDocument();
    expect(screen.getByText("bug fixes")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "前往下载" }));
    expect(openExternal).toHaveBeenCalledWith(DOWNLOAD_PAGE_URL);
    expect(acceptDownload).not.toHaveBeenCalled();
  });

  it("falls back to manual download via openExternal when only a downloadUrl exists", async () => {
    mockHookState({ status: "available", version: "9.9.9", downloadUrl: "https://dl.example" });
    renderUpdateChecker();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "前往下载" }));
    expect(openExternal).toHaveBeenCalledWith("https://dl.example");
    expect(dismissUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the downloaded dialog with restart actions", async () => {
    mockHookState({ status: "downloaded" });
    renderUpdateChecker();

    expect(await screen.findByText("更新已下载完成")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "立即重启" }));
    expect(acceptRestart).toHaveBeenCalledTimes(1);
    expect(dismissRestart).not.toHaveBeenCalled();
  });

  it("shows external update notes as literal list entries while preserving download", async () => {
    mockHookState({
      status: "available", version: "0.2.0", downloadUrl: "https://dl.example/app.dmg",
      releaseNotes: String.raw`- \!\[image\]\(https\:\/\/example\.com\) \<b\>hi\<\/b\> \*\*bold\*\* user\@example\.com
- https\:\/\/example\.com www\.example\.com`,
    });
    renderUpdateChecker();
    expect(await screen.findByText("更新内容")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("![image](https://example.com) <b>hi</b> **bold** user@example.com");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole("link", { name: "https://example.com" })[0]);
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    await userEvent.setup().click(screen.getByRole("button", { name: "前往下载" }));
    expect(openExternal).toHaveBeenCalledWith("https://dl.example/app.dmg");
  });

  it("offers inline Windows background download even when a download URL is present", async () => {
    mockHookState({ status: "available", updateMode: "inApp", version: "2.0.0", downloadUrl: "https://dl.example" });
    renderUpdateChecker();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "后台下载" }));
    expect(acceptDownload).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("offers inline Windows installation without a blocking dialog", async () => {
    mockHookState({ status: "downloaded", updateMode: "inApp" });
    renderUpdateChecker();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "安装并重启" }));
    expect(acceptRestart).toHaveBeenCalledOnce();
    expect(dismissRestart).not.toHaveBeenCalled();
  });

  it("disables installation while handing off to the installer", () => {
    mockHookState({ status: "installing", updateMode: "inApp" });
    renderUpdateChecker();
    expect(screen.getByRole("button", { name: "正在安装并重启..." })).toBeDisabled();
  });

  it("retries a Windows download failure without checking again", async () => {
    mockHookState({ status: "error", updateMode: "inApp", errorPhase: "download" });
    renderUpdateChecker();
    expect(screen.getByText("下载失败")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    expect(acceptDownload).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
  });

  it("distinguishes installation failures from check failures", () => {
    mockHookState({ status: "error", updateMode: "inApp", errorPhase: "install" });
    renderUpdateChecker();
    expect(screen.getByText("安装失败")).toBeInTheDocument();
  });

  it("preserves the installation action when the IPC transport fails", async () => {
    mockHookState({ status: "downloaded", updateMode: "inApp", errorPhase: "install", errorMessage: "IPC unavailable" });
    renderUpdateChecker();
    expect(screen.getByRole("alert")).toHaveTextContent("安装失败");
    await userEvent.setup().click(screen.getByRole("button", { name: "安装并重启" }));
    expect(acceptRestart).toHaveBeenCalledOnce();
  });
});
