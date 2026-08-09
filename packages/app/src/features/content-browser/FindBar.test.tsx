import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindBar } from "./FindBar";

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

function Harness({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <div ref={containerRef}>
        <pre>{text}</pre>
      </div>
      <FindBar containerRef={containerRef} contentKey="k" onClose={() => {}} />
    </div>
  );
}

function setTypeInInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function countLabel(): string {
  return host.querySelector("[data-content-findbar] span")?.textContent ?? "";
}

describe("FindBar", () => {
  it("renders an empty counter before any query, then shows N/M for matches", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text="foo bar foo" />);
    });
    expect(host.querySelector("input")).not.toBeNull();
    expect(countLabel()).toBe("");

    await act(async () => {
      setTypeInInput(host.querySelector("input")!, "foo");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(countLabel()).toBe("1/2");
  });

  it("shows the no-match label for a query with zero hits", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text="foo bar foo" />);
    });
    await act(async () => {
      setTypeInInput(host.querySelector("input")!, "zzz");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(countLabel()).toBe("无匹配");
  });

  it("disables prev/next when there are no matches", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text="foo bar foo" />);
    });
    const buttons = host.querySelectorAll("[data-content-findbar] button");
    // prev, next are the first two buttons (before close)
    expect(buttons[0].hasAttribute("disabled")).toBe(true);
    expect(buttons[1].hasAttribute("disabled")).toBe(true);

    await act(async () => {
      setTypeInInput(host.querySelector("input")!, "foo");
    });
    await act(async () => {
      await sleep(170);
    });
    const buttonsAfter = host.querySelectorAll("[data-content-findbar] button");
    expect(buttonsAfter[0].hasAttribute("disabled")).toBe(false);
    expect(buttonsAfter[1].hasAttribute("disabled")).toBe(false);
  });

  it("shows the 2000+ indicator when the cap is exceeded", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness text={"a".repeat(2010)} />);
    });
    await act(async () => {
      setTypeInInput(host.querySelector("input")!, "a");
    });
    await act(async () => {
      await sleep(170);
    });
    expect(countLabel()).toBe("1/2000+");
  });

  it("calls onClose when Escape is pressed in the input", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root = createRoot(host);
      root.render(
        <div>
          <div id="c">
            <pre>foo</pre>
          </div>
          <FindBarWrapper onClose={onClose} />
        </div>,
      );
    });
    const input = host.querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function FindBarWrapper({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return <FindBar containerRef={ref} contentKey="k" onClose={onClose} />;
}
