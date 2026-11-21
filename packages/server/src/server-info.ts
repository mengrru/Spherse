export const SERVER_VERSION = "0.1.0";
export const API_VERSION = "1";

let appVersion: string | undefined;

export function setAppVersion(version: string | undefined): void {
  appVersion = version;
}

export function getAppVersion(): string | undefined {
  return appVersion;
}
