import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./use-spherse-message-listener";

describe("isAllowedOrigin", () => {
  const devRenderer = "http://localhost:5173";
  const prodRenderer = "null";
  const serverOrigin = "http://localhost:3000";

  it("allows 'null' origin (production file:// srcDoc iframe)", () => {
    expect(isAllowedOrigin("null", prodRenderer, serverOrigin)).toBe(true);
  });

  it("allows renderer origin in dev (Vite dev server, inherited by srcDoc iframe)", () => {
    expect(isAllowedOrigin(devRenderer, devRenderer, serverOrigin)).toBe(true);
  });

  it("allows server origin", () => {
    expect(isAllowedOrigin(serverOrigin, devRenderer, serverOrigin)).toBe(true);
  });

  it("rejects unknown origin in dev mode", () => {
    expect(isAllowedOrigin("http://evil.com", devRenderer, serverOrigin)).toBe(false);
  });

  it("rejects renderer origin when it differs from event origin and is not server/null", () => {
    expect(isAllowedOrigin("http://localhost:8080", devRenderer, serverOrigin)).toBe(false);
  });

  it("rejects when serverOrigin is null and origin is neither null nor renderer", () => {
    expect(isAllowedOrigin("http://evil.com", devRenderer, null)).toBe(false);
  });

  it("still works when serverOrigin is null but event is renderer origin", () => {
    expect(isAllowedOrigin(devRenderer, devRenderer, null)).toBe(true);
  });

  it("production: 'null' origin is allowed regardless of renderer origin value", () => {
    expect(isAllowedOrigin("null", devRenderer, null)).toBe(true);
  });
});
