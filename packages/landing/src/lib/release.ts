import { GITHUB_RELEASES_LATEST_URL } from "./urls";

const MANIFEST_URL: string | undefined = import.meta.env.VITE_OSS_MANIFEST_URL;

export type Platform = "mac" | "win" | "linux";

export function detectPlatform(): Platform {
  // Android 的 UA / navigator.platform 都含 "Linux"，但它不是桌面 Linux 发布目标
  const isAndroid = /android/i.test(navigator.userAgent);
  try {
    const uaData = (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData;
    const platform = (uaData?.platform ?? navigator.platform ?? "").toLowerCase();
    if (platform.includes("win")) return "win";
    if (platform.includes("mac")) return "mac";
    if (platform.includes("linux") && !isAndroid) return "linux";
  } catch {
    // ignore — fall through to userAgent check
  }
  if (/win(?:dows)?/i.test(navigator.userAgent)) return "win";
  if (!isAndroid && /linux/i.test(navigator.userAgent)) return "linux";
  return "mac";
}

export interface Manifest {
  version: string;
  mac: { arm64: string; intel: string };
  win: { x64?: string; arm64?: string; setup?: string };
  // 可选键：pre-Linux 时代的旧 manifest / workflow_dispatch 重发旧 tag 时缺失
  linux?: { x64?: string };
}

export async function fetchLatestManifest(): Promise<Manifest> {
  if (!MANIFEST_URL) throw new Error("VITE_OSS_MANIFEST_URL not configured");
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`OSS manifest responded ${res.status}`);
  return (await res.json()) as Manifest;
}

async function detectWinArch(): Promise<"arm64" | "x64"> {
  try {
    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{
            architecture?: string;
          }>;
        };
      }
    ).userAgentData;
    const hints = await uaData?.getHighEntropyValues?.(["architecture"]);
    if (hints?.architecture === "arm") return "arm64";
  } catch {
    // ignore — fall through to default
  }
  return "x64";
}

function detectMacArch(): "arm64" | "intel" {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl2") as WebGLRenderingContext | null);
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) {
      const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      if (/Apple\s?(M\d|GPU)/i.test(renderer)) return "arm64";
      if (/Intel/i.test(renderer)) return "intel";
    }
  } catch {
    // ignore — fall through to default
  }
  return "arm64";
}

export async function resolveDownloadUrl(platform: Platform): Promise<string> {
  try {
    const manifest = await fetchLatestManifest();
    if (platform === "win") {
      const arch = await detectWinArch();
      if (arch === "arm64" && manifest.win?.arm64) return manifest.win.arm64;
      if (manifest.win?.x64) return manifest.win.x64;
      if (manifest.win?.setup) return manifest.win.setup;
    } else if (platform === "linux") {
      if (manifest.linux?.x64) return manifest.linux.x64;
    } else {
      const arch = detectMacArch();
      const url = manifest.mac?.[arch];
      if (url) return url;
    }
  } catch {
    // ignore — fall through to fallback
  }
  return GITHUB_RELEASES_LATEST_URL;
}
