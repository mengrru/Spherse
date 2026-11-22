import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRpcClientEnabled } from "./enabled";

describe("rpc client flag", () => {
  beforeEach(() => {
    delete (globalThis as { __SPHERSE_RPC_DISABLED__?: boolean }).__SPHERSE_RPC_DISABLED__;
    localStorage.removeItem("spherse:rpc-client");
  });

  afterEach(() => {
    (globalThis as { __SPHERSE_RPC_DISABLED__?: boolean }).__SPHERSE_RPC_DISABLED__ = true;
    localStorage.clear();
  });

  it("defaults to enabled", () => {
    expect(isRpcClientEnabled()).toBe(true);
  });

  it("opts out with explicit 0", () => {
    localStorage.setItem("spherse:rpc-client", "0");
    expect(isRpcClientEnabled()).toBe(false);
  });

  it("stays enabled with explicit 1", () => {
    localStorage.setItem("spherse:rpc-client", "1");
    expect(isRpcClientEnabled()).toBe(true);
  });
});
