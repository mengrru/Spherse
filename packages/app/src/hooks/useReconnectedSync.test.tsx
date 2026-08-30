import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReconnectedSync } from "./useReconnectedSync";
import { useBusStore } from "../stores/bus-store";

beforeEach(() => {
  useBusStore.setState({ status: "idle", resumedAt: null });
});

describe("useReconnectedSync", () => {
  it("does not fire on mount even when the bus already connected", () => {
    useBusStore.setState({ resumedAt: 111 });
    const onResync = vi.fn();
    renderHook(() => useReconnectedSync(onResync));
    expect(onResync).not.toHaveBeenCalled();
  });

  it("does not fire while no connection happened", () => {
    const onResync = vi.fn();
    renderHook(() => useReconnectedSync(onResync));
    expect(onResync).not.toHaveBeenCalled();
  });

  it("fires on the first connection observed after mount", () => {
    const onResync = vi.fn();
    renderHook(() => useReconnectedSync(onResync));
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("fires on every subsequent reconnect", () => {
    const onResync = vi.fn();
    renderHook(() => useReconnectedSync(onResync));
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    act(() => {
      useBusStore.setState({ resumedAt: 333 });
    });
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  it("does not fire again for the same resumedAt value", () => {
    const onResync = vi.fn();
    renderHook(() => useReconnectedSync(onResync));
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
    const { rerender } = renderHook(({ cb }) => useReconnectedSync(cb), {
      initialProps: { cb: first as () => void },
    });
    rerender({ cb: second });
    act(() => {
      useBusStore.setState({ resumedAt: 222 });
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
