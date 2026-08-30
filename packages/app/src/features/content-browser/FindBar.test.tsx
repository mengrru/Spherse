import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { FindBar } from "./FindBar";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function Harness({ text, onClose }: { text: string; onClose?: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <div ref={containerRef}>
        <pre>{text}</pre>
      </div>
      <FindBar containerRef={containerRef} contentKey="k" onClose={onClose ?? (() => {})} />
    </div>
  );
}

async function renderAndQuery(text: string, query: string) {
  render(<Harness text={text} />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("查找"), query);
  await act(async () => {
    await sleep(170);
  });
  return user;
}

function countLabel(): string {
  return document.querySelector("[data-content-findbar] span")?.textContent ?? "";
}

describe("FindBar", () => {
  it("renders an empty counter before any query, then shows N/M for matches", async () => {
    await renderAndQuery("foo bar foo", "foo");
    expect(countLabel()).toBe("1/2");
  });

  it("shows the no-match label for a query with zero hits", async () => {
    await renderAndQuery("foo bar foo", "zzz");
    expect(countLabel()).toBe("无匹配");
  });

  it("disables prev/next when there are no matches and enables them on hits", async () => {
    render(<Harness text="foo bar foo" />);
    const buttons = document.querySelectorAll("[data-content-findbar] button");
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("查找"), "foo");
    await act(async () => {
      await sleep(170);
    });
    const buttonsAfter = document.querySelectorAll("[data-content-findbar] button");
    expect(buttonsAfter[0]).toBeEnabled();
    expect(buttonsAfter[1]).toBeEnabled();
  });

  it("shows the 2000+ indicator when the cap is exceeded", async () => {
    await renderAndQuery("a".repeat(2010), "a");
    expect(countLabel()).toBe("1/2000+");
  });

  it("calls onClose when Escape is pressed in the input", async () => {
    const onClose = vi.fn();
    render(<Harness text="foo" onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("查找"), "{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
