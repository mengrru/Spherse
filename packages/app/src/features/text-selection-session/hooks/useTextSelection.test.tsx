import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTextSelection } from "./useTextSelection";

function Probe({ id }: { id: string }) {
  const { contentRef, selectionState } = useTextSelection({ disabled: false });
  return (
    <div>
      <div ref={contentRef} data-testid={`content-${id}`}>
        <p>{`text of ${id}`}</p>
      </div>
      <span data-testid={`state-${id}`}>{selectionState?.text ?? "none"}</span>
    </div>
  );
}

function selectText(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 10, clientY: 10, bubbles: true }));
  });
}

describe("useTextSelection with multiple instances", () => {
  const originalRects = Range.prototype.getClientRects;

  beforeEach(() => {
    Range.prototype.getClientRects = () =>
      [{ left: 0, top: 0, width: 10, height: 10 }] as unknown as DOMRectList;
  });

  afterEach(() => {
    Range.prototype.getClientRects = originalRects;
    vi.restoreAllMocks();
  });

  it("keeps only the snapshot of the pane that owns the latest selection", () => {
    render(
      <>
        <Probe id="left" />
        <Probe id="right" />
      </>,
    );

    selectText(screen.getByText("text of left"));
    expect(screen.getByTestId("state-left")).toHaveTextContent("text of left");
    expect(screen.getByTestId("state-right")).toHaveTextContent("none");

    selectText(screen.getByText("text of right"));
    expect(screen.getByTestId("state-right")).toHaveTextContent("text of right");
    expect(screen.getByTestId("state-left")).toHaveTextContent("none");
  });
});
