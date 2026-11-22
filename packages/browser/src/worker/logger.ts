import type { RpcLogger } from "@spherse/rpc/host";

export const consoleRpcLogger: RpcLogger = {
  debug() {},
  info(obj, msg) {
    console.info(obj, msg);
  },
  warn(obj, msg) {
    console.warn(obj, msg);
  },
  error(obj, msg) {
    console.error(obj, msg);
  },
};
