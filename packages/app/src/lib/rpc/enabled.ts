const STORAGE_KEY = "spherse:rpc-client";

export function isRpcClientEnabled(): boolean {
  if ((globalThis as { __SPHERSE_RPC_DISABLED__?: boolean }).__SPHERSE_RPC_DISABLED__) {
    return false;
  }
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
