import { describe, expect, it, vi } from "vitest";
import {
  DOCS_URL,
  DOWNLOAD_PAGE_URL,
  EXPLORE_URL,
  WEB_APP_URL,
} from "./urls";

describe("lib/urls", () => {
  it("derives site urls from the site origin with exact shapes", () => {
    expect(WEB_APP_URL).toBe("https://spherse.mengru.work/web/");
    expect(DOCS_URL).toBe("https://spherse.mengru.work/docs");
    expect(EXPLORE_URL).toBe("https://spherse.mengru.work/explore");
    expect(DOWNLOAD_PAGE_URL).toBe("https://spherse.mengru.work/");
  });

  it("points WEB_APP_URL at the dev web environment under the dev client", async () => {
    vi.resetModules();
    vi.stubEnv("MODE", "development");
    try {
      const urls = await import("./urls");
      expect(urls.WEB_APP_URL).toBe("https://spherse.mengru.work/dev/web/");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
