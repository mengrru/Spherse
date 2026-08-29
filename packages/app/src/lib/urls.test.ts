import { describe, expect, it } from "vitest";
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
});
