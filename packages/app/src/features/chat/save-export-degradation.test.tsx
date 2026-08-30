import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { BrowserPage } from "../../pages/BrowserPage";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { HtmlCardRenderer } from "./HtmlCard";
import { ImageCardRenderer } from "./ImageCard";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
    saveContent: vi.fn(),
    exportImage: vi.fn(),
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

let saveBlob: ReturnType<typeof vi.fn<(filename: string, blob: Blob) => Promise<void>>>;

beforeEach(() => {
  saveBlob = vi.fn(async () => {});
  vi.stubGlobal("fetch", vi.fn());
});

describe("web save degradation: HtmlCard", () => {
  it("falls back to saveBlob when showSaveDialog is unavailable", async () => {
    const user = userEvent.setup();
    const bridge = createMockHostBridge({ showSaveDialog: undefined, saveBlob });
    renderWithProviders(
      <HtmlCardRenderer card={{ type: "html", html: "<p>hi</p>", title: "My Card" } as never} />,
      { bridge },
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    const [filename, blob] = saveBlob.mock.calls[0];
    expect(filename).toBe("My Card.html");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/html");
  });

  it("renders the expanded overlay through a portal to document.body", async () => {
    const user = userEvent.setup();
    const bridge = createMockHostBridge();
    renderWithProviders(
      <HtmlCardRenderer card={{ type: "html", html: "<p>hi</p>" } as never} />,
      { bridge },
    );

    await user.click(screen.getByRole("button", { name: "全屏查看" }));

    const close = screen.getByRole("button", { name: "关闭" });
    const overlay = close.closest("div.fixed");
    expect(overlay).not.toBeNull();
    expect(overlay!.parentElement).toBe(document.body);
    expect(overlay!.querySelector("iframe")).not.toBeNull();
  });
});

describe("web save degradation: ImageCard", () => {
  it("falls back to fetching the preview url and saving a blob", async () => {
    const blob = new Blob(["img"], { type: "image/png" });
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => blob } as never);
    const user = userEvent.setup();
    const bridge = createMockHostBridge({ showSaveDialog: undefined, saveBlob });
    renderWithProviders(
      <ImageCardRenderer card={{ type: "image", path: "assets/pic.png", prompt: "a pic" } as never} />,
      { bridge },
    );

    await user.click(screen.getByRole("button", { name: "导出图片" }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("http://localhost:5173/api/projects/p1/preview/assets/pic.png");
    const [filename, saved] = saveBlob.mock.calls[0];
    expect(filename).toMatch(/^image-\d+\.png$/);
    expect(saved).toBeInstanceOf(Blob);
  });

  it("surfaces a toast when the preview fetch fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down") as never);
    const user = userEvent.setup();
    const bridge = createMockHostBridge({ showSaveDialog: undefined, saveBlob });
    renderWithProviders(
      <ImageCardRenderer card={{ type: "image", path: "assets/pic.png", prompt: "a pic" } as never} />,
      { bridge },
    );

    await user.click(screen.getByRole("button", { name: "导出图片" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls.at(-1)![0]).toContain("导出失败");
    expect(saveBlob).not.toHaveBeenCalled();
  });
});

describe("web degradation: BrowserPage redirect", () => {
  it("renders null instead of the browser view when the feature is disabled", () => {
    const webBridge = createMockHostBridge({ kind: "web" });
    renderWithProviders(
      <BrowserPage />,
      {
        bridge: webBridge,
        route: "/project/p1/browser?url=http://127.0.0.1:5173/x",
      },
    );

    expect(document.body.textContent).toBe("");
  });
});
