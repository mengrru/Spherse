import { describe, expect, it, vi } from "vitest";
import { buildConnectUrl, parseConnectPayload } from "./connect-payload";
import { WEB_APP_URL } from "./urls";

describe("buildConnectUrl", () => {
  it("builds prod web url with hash query by default", () => {
    expect(WEB_APP_URL).toBe("https://spherse.mengru.work/web/");
    expect(buildConnectUrl({ baseUrl: "https://abc.trycloudflare.com", token: "t0" })).toBe(
      "https://spherse.mengru.work/web/#/?base=https%3A%2F%2Fabc.trycloudflare.com&token=t0",
    );
  });

  it("appends targetPath when provided", () => {
    expect(
      buildConnectUrl({ baseUrl: "https://abc.trycloudflare.com", token: "t0", targetPath: "/project/p1/chat/s1" }),
    ).toBe(
      "https://spherse.mengru.work/web/#/?base=https%3A%2F%2Fabc.trycloudflare.com&token=t0&targetPath=%2Fproject%2Fp1%2Fchat%2Fs1",
    );
  });

  it("builds dev web url when MODE is development", async () => {
    vi.stubEnv("MODE", "development");
    vi.resetModules();
    const { buildConnectUrl: buildDev } = await import("./connect-payload");
    expect(buildDev({ baseUrl: "https://abc.trycloudflare.com", token: "t0" })).toBe(
      "https://spherse.mengru.work/dev/web/#/?base=https%3A%2F%2Fabc.trycloudflare.com&token=t0",
    );
    vi.unstubAllEnvs();
  });
});

describe("parseConnectPayload", () => {
  it("round-trips buildConnectUrl output (prod, with and without targetPath)", () => {
    const url = buildConnectUrl({ baseUrl: "https://abc.trycloudflare.com", token: "deadbeef" });
    expect(parseConnectPayload(url)).toEqual({ baseUrl: "https://abc.trycloudflare.com", token: "deadbeef" });

    const urlWithTarget = buildConnectUrl({
      baseUrl: "https://abc.trycloudflare.com",
      token: "deadbeef",
      targetPath: "/project/p1",
    });
    expect(parseConnectPayload(urlWithTarget)).toEqual({
      baseUrl: "https://abc.trycloudflare.com",
      token: "deadbeef",
      targetPath: "/project/p1",
    });
  });

  it("parses dev-deploy urls and strips trailing slashes from baseUrl", () => {
    expect(
      parseConnectPayload("https://spherse.mengru.work/dev/web/#/?base=https://abc.trycloudflare.com//&token=t0"),
    ).toEqual({ baseUrl: "https://abc.trycloudflare.com", token: "t0" });
  });

  it("parses payload carried in the search query instead of the hash", () => {
    expect(parseConnectPayload("https://example.com/?base=https://abc.trycloudflare.com&token=t0")).toEqual({
      baseUrl: "https://abc.trycloudflare.com",
      token: "t0",
    });
  });

  it("rejects non-http(s) schemes including the legacy spherse:// protocol", () => {
    expect(parseConnectPayload("spherse://connect?base=https://abc.trycloudflare.com&token=t0")).toBeNull();
    expect(parseConnectPayload("ftp://example.com/?base=x&token=y")).toBeNull();
  });

  it("rejects urls without both base and token, and non-url text", () => {
    expect(parseConnectPayload("https://example.com/#/?base=https://abc.trycloudflare.com")).toBeNull();
    expect(parseConnectPayload("https://example.com/#/?token=t0")).toBeNull();
    expect(parseConnectPayload("not a url")).toBeNull();
    expect(parseConnectPayload("")).toBeNull();
  });
});
