import { vi } from "vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeQueryBridge } from "./ThemeQueryBridge";
import { THEME_SETTINGS_CSS_PATH } from "../../../queries/theme-settings";
import { bumpBusResumedAt, connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../../test/bus";
import { renderWithProviders } from "../../../test/render";
import { queryClient as globalQueryClient } from "../../../queries/client";
import { projectQueryKeys } from "../../../queries/keys";

beforeEach(() => {
  stubMockBusSocket();
});

afterEach(() => {
  teardownMockBus();
  vi.restoreAllMocks();
});

function renderBridge() {
  renderWithProviders(<ThemeQueryBridge />);
}

function emitFsWatch(path: string) {
  emitBusEvent({
    channel: "fs-watch",
    projectId: "p1",
    type: "change",
    payload: { eventType: "change", path },
  });
}

describe("ThemeQueryBridge", () => {
  it("invalidates the theme-settings cache when fs-watch reports theme.css changed", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitFsWatch(THEME_SETTINGS_CSS_PATH);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.themeSettings("p1") });
  });

  it("ignores fs-watch events for other paths", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitFsWatch("README.md");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates after a bus reconnect", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");

    bumpBusResumedAt();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.themeSettings("p1") });
  });
});
