import type { ElectronAPI } from "../electron/types.js";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
