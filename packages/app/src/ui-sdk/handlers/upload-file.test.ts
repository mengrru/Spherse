import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateProjectFileQueries } from "../../queries/content";

vi.mock("../../queries/content", () => ({
  invalidateProjectFileQueries: vi.fn(async () => {}),
}));

const { dispatchAction } = await import("../registry");
await import("./upload-file");

function makeClient(uploadFile?: (dirPath: string, file: File) => Promise<unknown>) {
  return {
    uploadFile:
      uploadFile ??
      (vi.fn(async () => ({ path: "docs/a.png", bytes: 3, renamed: false })) as any),
  } as any;
}

function makeCtx(client: any, hostKind: "electron" | "web" = "electron") {
  const postMessage = vi.fn();
  return {
    client,
    projectId: "proj-1",
    navigate: vi.fn(),
    hostKind,
    requestId: "req-1",
    source: { postMessage } as any,
  } as any;
}

function lastResponse(ctx: any) {
  const calls = ctx.source.postMessage.mock.calls;
  return calls[calls.length - 1]?.[0];
}

function pngBlob(): Blob {
  return new Blob(["abc"], { type: "image/png" });
}

function oversizedBlob(): Blob {
  const blob = pngBlob();
  Object.defineProperty(blob, "size", { value: 100 * 1024 * 1024 + 1 });
  return blob;
}

beforeEach(() => {
  vi.mocked(invalidateProjectFileQueries).mockClear();
});

describe("uploadFile action", () => {
  it("uploads a File and responds with the upload response", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    const file = new File(["abc"], "a.png", { type: "image/png" });
    await dispatchAction("uploadFile", { dirPath: "docs", data: file }, ctx);
    expect(client.uploadFile).toHaveBeenCalledWith("docs", file);
    expect(lastResponse(ctx)).toMatchObject({
      ok: true,
      data: { path: "docs/a.png", bytes: 3, renamed: false },
    });
    expect(invalidateProjectFileQueries).toHaveBeenCalledWith("proj-1", "docs/a.png");
  });

  it("uploads to the project root when dirPath is omitted", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    const file = new File(["abc"], "a.png", { type: "image/png" });
    await dispatchAction("uploadFile", { data: file }, ctx);
    expect(client.uploadFile).toHaveBeenCalledWith("", file);
  });

  it("wraps a plain Blob with the given name", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    const blob = pngBlob();
    await dispatchAction("uploadFile", { dirPath: "docs", name: "b.jpg", data: blob }, ctx);
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    const [dirPath, file] = client.uploadFile.mock.calls[0];
    expect(dirPath).toBe("docs");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("b.jpg");
  });

  it("renames a File when an explicit name is provided", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    const file = new File(["<html>"], "evil.html", { type: "text/html" });
    await dispatchAction("uploadFile", { dirPath: "docs", name: "ok.png", data: file }, ctx);
    const [, uploaded] = client.uploadFile.mock.calls[0];
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.name).toBe("ok.png");
    expect(lastResponse(ctx)).toMatchObject({ ok: true });
  });

  it("rejects non-Blob data", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("uploadFile", { name: "a.png", data: "not a blob" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
  });

  it("rejects a Blob without a name", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("uploadFile", { data: pngBlob() }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
  });

  it("rejects an explicitly blank name instead of falling back to File.name", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    const file = new File(["abc"], "a.png", { type: "image/png" });
    await dispatchAction("uploadFile", { name: "  ", data: file }, ctx);
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
  });

  it("rejects unsupported extensions", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction(
      "uploadFile",
      { data: new File(["x"], "tool.exe"), dirPath: "docs" },
      ctx,
    );
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "unsupported_type" } });

    await dispatchAction(
      "uploadFile",
      { data: new File(["x"], "page.html"), dirPath: "docs" },
      ctx,
    );
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "unsupported_type" } });

    await dispatchAction("uploadFile", { data: new File(["x"], "README"), dirPath: "docs" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "unsupported_type" } });
  });

  it("matches extensions case-insensitively", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    await dispatchAction(
      "uploadFile",
      { data: new File(["abc"], "IMG.PNG", { type: "image/png" }), dirPath: "docs" },
      ctx,
    );
    expect(lastResponse(ctx)).toMatchObject({ ok: true });
  });

  it("rejects files over 100MB before hitting the server", async () => {
    const client = makeClient();
    const ctx = makeCtx(client);
    await dispatchAction("uploadFile", { name: "big.png", data: oversizedBlob() }, ctx);
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "file_too_large" } });
  });

  it("forbids dirPath inside the .spherse subtree", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("uploadFile", { dirPath: ".spherse/skills", name: "a.png", data: pngBlob() }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "forbidden" } });

    await dispatchAction("uploadFile", { dirPath: ".Spherse/x", name: "a.png", data: pngBlob() }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "forbidden" } });
  });

  it("rejects non-normalizable dirPath forms", async () => {
    const ctx = makeCtx(makeClient());
    const cases = [
      "/etc",
      "docs\\sub",
      "foo/../.spherse/skills",
      "docs/..",
      "docs/./sub",
      "docs//sub",
      42,
    ];
    for (const dirPath of cases) {
      await dispatchAction("uploadFile", { dirPath, name: "a.png", data: pngBlob() }, ctx);
      expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
    }
  });

  it("rejects names containing path separators instead of rewriting", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("uploadFile", { name: "a/b.png", data: pngBlob() }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
  });

  it("is forbidden on web hosts", async () => {
    const client = makeClient();
    const ctx = makeCtx(client, "web");
    await dispatchAction(
      "uploadFile",
      { data: new File(["abc"], "a.png", { type: "image/png" }) },
      ctx,
    );
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "forbidden" } });
  });

  it("fails with bad_request when the client is missing", async () => {
    const ctx = makeCtx(null);
    await dispatchAction("uploadFile", { name: "a.png", data: pngBlob() }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
  });

  it("fails with upload_failed when the server rejects the upload", async () => {
    const client = makeClient(async () => {
      throw new Error("boom");
    });
    const ctx = makeCtx(client);
    await dispatchAction(
      "uploadFile",
      { data: new File(["abc"], "a.png", { type: "image/png" }), dirPath: "missing" },
      ctx,
    );
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "upload_failed" } });
    expect(invalidateProjectFileQueries).not.toHaveBeenCalled();
  });
});
