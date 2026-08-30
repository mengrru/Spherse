import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { useContentFind, type ContentFindApi } from "./useContentFind";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

function renderHarness(text: string) {
  let api: ContentFindApi | null = null;
  const view = render(<Harness text={text} onApi={(a) => (api = a)} />);
  return {
    view,
    api: () => {
      if (!api) throw new Error("api not captured");
      return api;
    },
  };
}

describe("useContentFind", () => {
  it("counts matches and cycles next/prev with wraparound", async () => {
    const { api } = renderHarness("foo bar foo baz foo");
    await act(async () => {
      api().setQuery("foo");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api().matchCount).toBe(3);
    expect(api().matchIndex).toBe(0);

    await act(async () => {
      api().next();
    });
    expect(api().matchIndex).toBe(1);
    await act(async () => {
      api().next();
    });
    expect(api().matchIndex).toBe(2);
    await act(async () => {
      api().next();
    });
    expect(api().matchIndex).toBe(0);

    await act(async () => {
      api().prev();
    });
    expect(api().matchIndex).toBe(2);
  });

  it("clears matches when the query is emptied", async () => {
    const { api } = renderHarness("alpha alpha");
    await act(async () => {
      api().setQuery("alpha");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api().matchCount).toBe(2);
    await act(async () => {
      api().setQuery("");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api().matchCount).toBe(0);
    expect(api().matchIndex).toBe(-1);
  });

  it("caps matches at the limit and reports overLimit", async () => {
    const { api } = renderHarness("a".repeat(2010));
    await act(async () => {
      api().setQuery("a");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(api().matchCount).toBe(2000);
    expect(api().overLimit).toBe(true);
  });

  it("cleans up the highlight <mark> on unmount (fallback path)", async () => {
    const { view, api } = renderHarness("hello world hello");
    await act(async () => {
      api().setQuery("hello");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(view.container.querySelectorAll("mark.sp-find-mark").length).toBeGreaterThan(0);

    view.unmount();
    expect(view.container.querySelectorAll("mark.sp-find-mark").length).toBe(0);
  });
});
