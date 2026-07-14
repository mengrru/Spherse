const RELEASES_API =
  "https://api.github.com/repos/mengrru/Spherse/releases/latest";
const FALLBACK_URL = "https://github.com/mengrru/Spherse/releases/latest";

export type Platform = "mac" | "win";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

async function fetchLatestRelease(): Promise<Release> {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  return (await res.json()) as Release;
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
    const release = await fetchLatestRelease();
    if (platform === "win") {
      const exe = release.assets.find((a) => a.name.endsWith(".exe"));
      if (exe) return exe.browser_download_url;
    } else {
      const arch = detectMacArch();
      const dmg =
        release.assets.find((a) => a.name.includes(arch)) ??
        release.assets.find((a) => a.name.endsWith(".dmg"));
      if (dmg) return dmg.browser_download_url;
    }
  } catch {
    // ignore — fall through to fallback
  }
  return FALLBACK_URL;
}
