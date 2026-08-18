import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFsWatchRefresh } from "./useFsWatchRefresh";
import { useBusStore } from "../../../stores/bus-store";

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  useBusStore.setState({ status: "idle", resumedAt: null });
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
});

describe("useFsWatchRefresh", () => {
  it("refreshes the tree after a reconnect (resume compensation)", async () => {
    const refreshRoot = vi.fn().mockResolvedValue(undefined);
    const Probe = () => {
      useFsWatchRefresh("p1", refreshRoot);
      return null;
    };
    act(() => {
      root = createRoot(host);
      root.render(<Probe />);
    });
    expect(refreshRoot).not.toHaveBeenCalled();

    act(() => {
      useBusStore.setState({ resumedAt: (useBusStore.getState().resumedAt ?? 0) + 1 });
    });
    expect(refreshRoot).toHaveBeenCalledTimes(1);
  });
});
