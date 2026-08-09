import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useContentFind, type ContentFindApi } from "./useContentFind";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
});

function Harness({
  text,
  contentKey = "k",
  onApi,
}: {
  text: string;
  contentKey?: string;
  onApi: (api: ContentFindApi) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const api = useContentFind({ containerRef, contentKey });
  useEffect(() => {
    onApi(api);
  });
  return (
    <div ref={containerRef}>
      <pre>{text}</pre>
    </div>
  );
}

describe("useContentFind", () => {
  it("counts matches and cycles next/prev with wraparound", async () => {
    let api: ContentFindApi | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text="foo bar foo baz foo" onApi={(a) => (api = a)} />);
    });
    await act(async () => {
      api!.setQuery("foo");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api!.matchCount).toBe(3);
    expect(api!.matchIndex).toBe(0);

    await act(async () => {
      api!.next();
    });
    expect(api!.matchIndex).toBe(1);
    await act(async () => {
      api!.next();
    });
    expect(api!.matchIndex).toBe(2);
    await act(async () => {
      api!.next();
    });
    expect(api!.matchIndex).toBe(0);

    await act(async () => {
      api!.prev();
    });
    expect(api!.matchIndex).toBe(2);
  });

  it("clears matches when the query is emptied", async () => {
    let api: ContentFindApi | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text="alpha alpha" onApi={(a) => (api = a)} />);
    });
    await act(async () => {
      api!.setQuery("alpha");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api!.matchCount).toBe(2);
    await act(async () => {
      api!.setQuery("");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api!.matchCount).toBe(0);
    expect(api!.matchIndex).toBe(-1);
  });

  it("caps matches at the limit and reports overLimit", async () => {
    let api: ContentFindApi | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text={"a".repeat(2010)} onApi={(a) => (api = a)} />);
    });
    await act(async () => {
      api!.setQuery("a");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api!.matchCount).toBe(2000);
    expect(api!.overLimit).toBe(true);
  });

  it("cleans up the highlight <mark> on unmount (fallback path)", async () => {
    let api: ContentFindApi | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text="hello world hello" onApi={(a) => (api = a)} />);
    });
    await act(async () => {
      api!.setQuery("hello");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(host.querySelectorAll("mark.sp-find-mark").length).toBeGreaterThan(0);

    act(() => {
      root!.unmount();
      root = null;
    });
    expect(host.querySelectorAll("mark.sp-find-mark").length).toBe(0);
  });
});
