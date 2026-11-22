import { describe, expect, it } from "vitest";
import { HostServiceKey, createHostContext } from "@spherse/core";
import { defineRpcMethod } from "../context.js";
import { getRpcMethodGroups, registerRpcMethodGroups } from "../host-bridge.js";

const ping = defineRpcMethod({} as never, () => "pong");
const echo = defineRpcMethod({} as never, (params) => params);

describe("rpc host bridge", () => {
  it("registers method groups as a host service and merges incrementally", () => {
    const host = createHostContext();
    const first = registerRpcMethodGroups(host, [{ "test.ping": ping }]);
    expect(first.get("test.ping")).toBe(ping);
    const merged = registerRpcMethodGroups(host, [new Map([["test.echo", echo]])]);
    expect(merged.size).toBe(2);
    expect(getRpcMethodGroups(host)).toBe(merged);
    expect(host.get(HostServiceKey.rpcMethods)).toBe(merged);
  });

  it("rejects duplicate method names across groups", () => {
    const host = createHostContext();
    registerRpcMethodGroups(host, [{ "test.ping": ping }]);
    expect(() => registerRpcMethodGroups(host, [{ "test.ping": echo }])).toThrow(/Duplicate rpc method/);
  });

  it("throws when groups are missing on a fresh host", () => {
    const host = createHostContext();
    expect(() => getRpcMethodGroups(host)).toThrow(/not registered/);
  });
});
