import { describe, expect, it } from "vitest";
import { DEFAULT_FRONTEND_URL, buildLoginUrl, renderStartupMessage } from "../echo.js";

describe("buildLoginUrl", () => {
  it("matches the buildConnectUrl wire format exactly", () => {
    const url = buildLoginUrl({
      frontendUrl: DEFAULT_FRONTEND_URL,
      baseUrl: "http://127.0.0.1:53972",
      token: "abc123",
    });
    expect(url).toBe("https://spherse.mengru.work/web/#/?base=http%3A%2F%2F127.0.0.1%3A53972&token=abc123");
  });

  it("normalizes trailing slashes on the frontend url", () => {
    const url = buildLoginUrl({ frontendUrl: "https://example.com/app/", baseUrl: "http://localhost:1", token: "t" });
    expect(url.startsWith("https://example.com/app/#/?")).toBe(true);
    const bare = buildLoginUrl({ frontendUrl: "https://example.com/app", baseUrl: "http://localhost:1", token: "t" });
    expect(bare.startsWith("https://example.com/app/#/?")).toBe(true);
  });
});

describe("renderStartupMessage", () => {
  it("includes endpoint, token and login url", () => {
    const message = renderStartupMessage({
      endpoint: "http://127.0.0.1:53972",
      token: "tok",
      loginUrl: "https://spherse.mengru.work/web/#/?base=x&token=tok",
    });
    expect(message).toContain("http://127.0.0.1:53972");
    expect(message).toContain("tok");
    expect(message).toContain("https://spherse.mengru.work/web/#/?base=x&token=tok");
    expect(message).toContain("Treat the token like a password");
  });
});
