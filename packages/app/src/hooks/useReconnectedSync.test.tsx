import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReconnectedSync } from "./useReconnectedSync";
import { useBusStore } from "../stores/bus-store";

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

function renderHook() {
  const onResync = vi.fn();
  const Probe = () => {
    useReconnectedSync(onResync);
    return null;
  };
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
  return onResync;
}

describe("useReconnectedSync", () => {
  it("does not fire on mount even when the bus already connected", () => {
    useBusStore.setState({ resumedAt: 111 });
    const onResync = renderHook();
    expect(onResync).not.toHaveBeenCalled();
  });

  it("does not fire while no connection happened", () => {
    const onResync = renderHook();
    expect(onResync).not.toHaveBeenCalled();
  });

  it("fires on the first connection observed after mount", () => {
    const onResync = renderHook();
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("fires on every subsequent reconnect", () => {
    const onResync = renderHook();
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    act(() => {
      useBusStore.setState({ resumedAt: 333 });
    });
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  it("does not fire again for the same resumedAt value", () => {
    const onResync = renderHook();
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    act(() => {
      useBusStore.setState({ status: "open", resumedAt: 222 });
    });
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("always invokes the latest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const Probe = ({ cb }: { cb: () => void }) => {
      useReconnectedSync(cb);
      return null;
    };
    act(() => {
      root = createRoot(host);
      root.render(<Probe cb={first} />);
    });
    act(() => {
      root!.render(<Probe cb={second} />);
    });
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
