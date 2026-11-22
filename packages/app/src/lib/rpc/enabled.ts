const STORAGE_KEY = "spherse:rpc-client";

export function isRpcClientEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
