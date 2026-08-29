import { describe, expect, it } from "vitest";
import { ModelNotConfiguredError, ConflictError, ValidationError } from "@spherse/core";
import { ErrorEventCode } from "@spherse/contracts";
import { classifyRunError } from "../classify-run-error.js";

describe("classifyRunError", () => {
  it("classifies ModelNotConfiguredError", () => {
    expect(classifyRunError(new ModelNotConfiguredError())).toBe(
      ErrorEventCode.ModelNotConfigured,
    );
  });

  it("classifies ConflictError and ValidationError as permanent", () => {
    expect(classifyRunError(new ConflictError("already running"))).toBe(ErrorEventCode.Permanent);
    expect(classifyRunError(new ValidationError("no failed turn"))).toBe(ErrorEventCode.Permanent);
  });

  it("classifies 429 as transient", () => {
    expect(classifyRunError(withStatus(429))).toBe(ErrorEventCode.Transient);
  });

  it("classifies 5xx as transient", () => {
    expect(classifyRunError(withStatus(500))).toBe(ErrorEventCode.Transient);
    expect(classifyRunError(withStatus(502))).toBe(ErrorEventCode.Transient);
    expect(classifyRunError(withStatus(503))).toBe(ErrorEventCode.Transient);
  });

  it("classifies 401/403 as auth", () => {
    expect(classifyRunError(withStatus(401))).toBe(ErrorEventCode.Auth);
    expect(classifyRunError(withStatus(403))).toBe(ErrorEventCode.Auth);
  });

  it("classifies 4xx (non-401/403/429) as permanent", () => {
    expect(classifyRunError(withStatus(400))).toBe(ErrorEventCode.Permanent);
    expect(classifyRunError(withStatus(404))).toBe(ErrorEventCode.Permanent);
  });

  it("classifies network errors (no status) as transient", () => {
    expect(classifyRunError(new Error("fetch failed"))).toBe(ErrorEventCode.Transient);
    expect(classifyRunError(new Error("ETIMEDOUT"))).toBe(ErrorEventCode.Transient);
    expect(classifyRunError(new Error("ECONNRESET"))).toBe(ErrorEventCode.Transient);
  });

  it("defaults indeterminate errors to transient", () => {
    expect(classifyRunError(new Error("oops"))).toBe(ErrorEventCode.Transient);
    expect(classifyRunError("string error")).toBe(ErrorEventCode.Transient);
    expect(classifyRunError(null)).toBe(ErrorEventCode.Transient);
  });

  it("reads statusCode alias", () => {
    const err = Object.assign(new Error("rate limited"), { statusCode: 429 });
    expect(classifyRunError(err)).toBe(ErrorEventCode.Transient);
  });
});

function withStatus(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}
