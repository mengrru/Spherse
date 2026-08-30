import { vi } from "vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WelcomePageQueryBridge } from "./WelcomePageQueryBridge";
import { bumpBusResumedAt, connectMockBus, emitBusEvent, stubMockBusSocket, teardownMockBus } from "../../test/bus";
import { renderWithProviders } from "../../test/render";
import { queryClient as globalQueryClient } from "../../queries/client";
import { projectQueryKeys } from "../../queries/keys";
import { WELCOME_PAGE_CONFIG_PATH } from "../../queries/welcome-page";

beforeEach(() => {
  stubMockBusSocket();
});

afterEach(() => {
  teardownMockBus();
  vi.restoreAllMocks();
});

function renderBridge() {
  renderWithProviders(<WelcomePageQueryBridge />);
}

function emitFsWatch(path: string) {
  emitBusEvent({
    channel: "fs-watch",
    projectId: "p1",
    type: "change",
    payload: { eventType: "change", path },
  });
}

describe("WelcomePageQueryBridge", () => {
  it("invalidates the welcome-page cache when fs-watch reports project.yaml changed", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitFsWatch(WELCOME_PAGE_CONFIG_PATH);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.welcomePage("p1") });
  });

  it("ignores fs-watch events for other paths", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");
    emitFsWatch("index.html");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates after a bus reconnect", async () => {
    renderBridge();
    await connectMockBus();
    const invalidate = vi.spyOn(globalQueryClient, "invalidateQueries");

    bumpBusResumedAt();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectQueryKeys.welcomePage("p1") });
  });
});
