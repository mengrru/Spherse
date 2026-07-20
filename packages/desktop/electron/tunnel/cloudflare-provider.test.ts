import { describe, expect, it } from "vitest";

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

describe("cloudflare url regex", () => {
  it("matches a typical cloudflared quick-tunnel URL in stdout", () => {
    const sample = `
 2026-07-20T10:00:00Z INF Thank you for trying Cloudflare Tunnel...
 2026-07-20T10:00:00Z INF +--------------------------------------------------------------------------------------------+
 2026-07-20T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
 2026-07-20T10:00:00Z INF |  https://random-words-123.trycloudflare.com                                                |
 2026-07-20T10:00:00Z INF +--------------------------------------------------------------------------------------------+
`;
    const match = URL_REGEX.exec(sample);
    expect(match).not.toBeNull();
    expect(match?.[0]).toBe("https://random-words-123.trycloudflare.com");
  });

  it("matches only the first URL when multiple appear", () => {
    const sample = "https://aaa-bbb.trycloudflare.com and https://ccc-ddd.trycloudflare.com";
    const match = URL_REGEX.exec(sample);
    expect(match?.[0]).toBe("https://aaa-bbb.trycloudflare.com");
  });

  it("does not match http URLs", () => {
    expect(URL_REGEX.exec("http://aaa-bbb.trycloudflare.com")).toBeNull();
  });

  it("does not match unrelated URLs", () => {
    expect(URL_REGEX.exec("https://example.com")).toBeNull();
  });
});
