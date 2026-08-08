import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/server/contracts";
import { classifyErrorMessageString } from "./classify-error";

describe("classifyErrorMessageString", () => {
  it("classifies transient signals", () => {
    expect(classifyErrorMessageString("Rate limit exceeded")).toBe(ErrorEventCode.Transient);
    expect(classifyErrorMessageString("429 Too Many Requests")).toBe(ErrorEventCode.Transient);
    expect(classifyErrorMessageString("Request timed out")).toBe(ErrorEventCode.Transient);
    expect(classifyErrorMessageString("fetch failed")).toBe(ErrorEventCode.Transient);
    expect(classifyErrorMessageString("the server is overloaded")).toBe(ErrorEventCode.Transient);
    expect(classifyErrorMessageString("Service Unavailable")).toBe(ErrorEventCode.Transient);
  });

  it("classifies permanent overflow errors before transient", () => {
    expect(classifyErrorMessageString("prompt is too long: 213462 tokens")).toBe(ErrorEventCode.Permanent);
    expect(classifyErrorMessageString("Your input exceeds the context window")).toBe(ErrorEventCode.Permanent);
    expect(classifyErrorMessageString("exceeded model token limit")).toBe(ErrorEventCode.Permanent);
  });

  it("classifies permanent hints", () => {
    expect(classifyErrorMessageString("invalid api key")).toBe(ErrorEventCode.Permanent);
    expect(classifyErrorMessageString("unauthorized access")).toBe(ErrorEventCode.Permanent);
  });

  it("defaults indeterminate errors to transient", () => {
    expect(classifyErrorMessageString("something went wrong")).toBe(ErrorEventCode.Transient);
    expect(classifyErrorMessageString("")).toBe(ErrorEventCode.Transient);
  });
});
