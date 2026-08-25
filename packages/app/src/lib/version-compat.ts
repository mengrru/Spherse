import { compareSemver, isValidSemver } from "./semver";

export type AppVersionCompatibility = "ok" | "patch-mismatch" | "incompatible" | "unknown";

export function compareAppVersion(
  appVersion: string | null | undefined,
  webVersion: string,
): AppVersionCompatibility {
  if (!appVersion || !isValidSemver(appVersion) || !isValidSemver(webVersion)) {
    return "unknown";
  }
  const [appMajor, appMinor] = appVersion.split(".").map(Number);
  const [webMajor, webMinor] = webVersion.split(".").map(Number);
  if (appMajor !== webMajor || appMinor !== webMinor) return "incompatible";
  return compareSemver(appVersion, webVersion) === 0 ? "ok" : "patch-mismatch";
}
