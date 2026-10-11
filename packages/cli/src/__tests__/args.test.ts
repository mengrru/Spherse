import { describe, expect, it } from "vitest";
import { CliArgError, parseArgs } from "../args.js";

describe("parseArgs", () => {
  it("returns help for empty argv", () => {
    expect(parseArgs([])).toEqual({ command: "help" });
  });

  it("recognizes help variants", () => {
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
    expect(parseArgs(["-h"])).toEqual({ command: "help" });
    expect(parseArgs(["help"])).toEqual({ command: "help" });
  });

  it("recognizes version variants", () => {
    expect(parseArgs(["--version"])).toEqual({ command: "version" });
    expect(parseArgs(["-v"])).toEqual({ command: "version" });
  });

  it("parses server flags in both forms", () => {
    expect(parseArgs(["server", "--port", "8080", "--home", "/tmp/x", "--frontend-url", "https://a.b/"])).toEqual({
      command: "server",
      port: 8080,
      home: "/tmp/x",
      frontendUrl: "https://a.b/",
    });
    expect(parseArgs(["server", "--port=8080", "--home=/tmp/x"])).toEqual({
      command: "server",
      port: 8080,
      home: "/tmp/x",
    });
  });

  it("allows port 0 (random)", () => {
    expect(parseArgs(["server", "--port", "0"]).port).toBe(0);
  });

  it("rejects invalid ports", () => {
    expect(() => parseArgs(["server", "--port", "abc"])).toThrow(CliArgError);
    expect(() => parseArgs(["server", "--port", "-1"])).toThrow(CliArgError);
    expect(() => parseArgs(["server", "--port", "65536"])).toThrow(CliArgError);
    expect(() => parseArgs(["server", "--port", "1.5"])).toThrow(CliArgError);
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseArgs(["server", "--nope", "1"])).toThrow(/unknown option/);
    expect(() => parseArgs(["server", "--port"])).toThrow(/requires a value/);
    expect(() => parseArgs(["server", "--port="])).toThrow(/requires a value/);
  });

  it("rejects server positional args", () => {
    expect(() => parseArgs(["server", "extra"])).toThrow(CliArgError);
  });

  it("parses new command", () => {
    expect(parseArgs(["new", "world"])).toEqual({ command: "new", name: "world" });
    expect(parseArgs(["new", "world", "--home", "/tmp/x"])).toEqual({
      command: "new",
      name: "world",
      home: "/tmp/x",
    });
  });

  it("rejects new without exactly one name", () => {
    expect(() => parseArgs(["new"])).toThrow(/exactly one/);
    expect(() => parseArgs(["new", "a", "b"])).toThrow(/exactly one/);
  });

  it("rejects new-only flags on server and vice versa", () => {
    expect(() => parseArgs(["new", "a", "--port", "1"])).toThrow(/unknown option/);
    expect(() => parseArgs(["server", "--frontend-url", "https://a.b/"])).not.toThrow();
  });

  it("rejects unknown commands", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow(/unknown command/);
  });
});
