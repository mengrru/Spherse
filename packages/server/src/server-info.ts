let appVersion: string | undefined;

export function setAppVersion(version: string | undefined): void {
  appVersion = version;
}

export function getAppVersion(): string | undefined {
  return appVersion;
}
