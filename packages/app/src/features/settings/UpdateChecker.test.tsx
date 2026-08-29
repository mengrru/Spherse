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

  it("shows the update dialog with auto download when a version is available", async () => {
    mockHookState({ status: "available", version: "9.9.9", releaseNotes: "bug fixes" });
    renderUpdateChecker();

    expect(await screen.findByText("发现新版本 v9.9.9")).toBeInTheDocument();
    expect(screen.getByText("更新内容")).toBeInTheDocument();
    expect(screen.getByText("bug fixes")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "立即更新" }));
    expect(acceptDownload).toHaveBeenCalledTimes(1);
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
});
