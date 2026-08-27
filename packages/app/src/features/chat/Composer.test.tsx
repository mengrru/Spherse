import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProvider } from "../../context/project-context";
import { Composer } from "./Composer";
import type { AttachedImage } from "./types";

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
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderComposer(props: { streaming?: boolean; loading?: boolean }) {
  const onSend = vi.fn(() => true);
  const onAbort = vi.fn();
  act(() => {
    root = createRoot(host);
    root.render(
      <ProjectProvider projectId="p1" projectRoot="/tmp/p1">
        <Composer
          streaming={props.streaming ?? false}
          loading={props.loading ?? false}
          sessionId="session-1"
          onSend={onSend}
          onAbort={onAbort}
        />
      </ProjectProvider>,
    );
  });
  return { onSend, onAbort };
}

function rerenderComposer(props: { streaming?: boolean; loading?: boolean }, onSend: (message: string, image?: AttachedImage) => boolean, onAbort: () => void) {
  act(() => {
    root!.render(
      <ProjectProvider projectId="p1" projectRoot="/tmp/p1">
        <Composer
          streaming={props.streaming ?? false}
          loading={props.loading ?? false}
          sessionId="session-1"
          onSend={onSend}
          onAbort={onAbort}
        />
      </ProjectProvider>,
    );
  });
}

function textarea(): HTMLTextAreaElement {
  return host.querySelector("textarea")!;
}

function composerButton(svgClass: string): HTMLButtonElement {
  const svg = host.querySelector(`[data-chat-composer] button svg.${svgClass}`);
  if (!svg) throw new Error(`button with ${svgClass} not found`);
  return svg.closest("button") as HTMLButtonElement;
}

function type(value: string): void {
  const el = textarea();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => {
    textarea().dispatchEvent(event);
  });
  return event;
}

describe("Composer input availability", () => {
  it("keeps the textarea enabled while the agent is streaming", () => {
    renderComposer({ streaming: true });
    expect(textarea().hasAttribute("disabled")).toBe(false);
  });

  it("accepts typed text while streaming and preserves it as a draft", () => {
    renderComposer({ streaming: true });
    type("继续执行");
    expect(textarea().value).toBe("继续执行");

    rerenderComposer({ streaming: false }, vi.fn(() => true), vi.fn());
    expect(textarea().value).toBe("继续执行");
  });

  it("does not send the draft on Enter while streaming", () => {
    const { onSend } = renderComposer({ streaming: true });
    type("流式期间输入");
    pressEnter();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends the draft typed during streaming once streaming ends", () => {
    const { onSend, onAbort } = renderComposer({ streaming: true });
    type("流式期间输入");

    rerenderComposer({ streaming: false }, onSend, onAbort);
    expect(composerButton("lucide-send").hasAttribute("disabled")).toBe(false);

    act(() => {
      composerButton("lucide-send").click();
    });
    expect(onSend).toHaveBeenCalledWith("流式期间输入", undefined);
  });

  it("swaps the send button for the abort button while streaming and aborts on click", () => {
    const { onAbort } = renderComposer({ streaming: true });
    expect(host.querySelector("[data-chat-composer] button svg.lucide-send")).toBeNull();

    act(() => {
      composerButton("lucide-square").click();
    });
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("shows the image icon on the attach button instead of the paperclip", () => {
    renderComposer({ streaming: false });
    expect(host.querySelector("[data-chat-composer] button svg.lucide-image")).not.toBeNull();
    expect(host.querySelector("[data-chat-composer] button svg.lucide-paperclip")).toBeNull();
  });

  it("still disables the textarea while session history is loading", () => {
    renderComposer({ loading: true });
    expect(textarea().hasAttribute("disabled")).toBe(true);
  });

  it("keeps the textarea disabled when streaming and loading are both true", () => {
    renderComposer({ streaming: true, loading: true });
    expect(textarea().hasAttribute("disabled")).toBe(true);
  });
});

describe("Composer enter key behavior", () => {
  function mockPointerCoarse(matches: boolean) {
    vi.spyOn(window, "matchMedia").mockImplementation(((query: string) => ({
      matches: query.includes("coarse") && matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia);
  }

  it("sends the draft on Enter with a fine pointer", () => {
    mockPointerCoarse(false);
    const { onSend } = renderComposer({ streaming: false });
    type("hello world");
    const event = pressEnter();
    expect(onSend).toHaveBeenCalledWith("hello world", undefined);
    expect(event.defaultPrevented).toBe(true);
    expect(textarea().getAttribute("enterkeyhint")).toBe("send");
  });

  it("inserts a newline instead of sending on touch keyboards", () => {
    mockPointerCoarse(true);
    const { onSend } = renderComposer({ streaming: false });
    type("第一行");
    const event = pressEnter();
    expect(onSend).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(textarea().value).toBe("第一行");
    expect(textarea().getAttribute("enterkeyhint")).toBe("enter");
  });

  it("still sends from the send button on touch keyboards", () => {
    mockPointerCoarse(true);
    const { onSend } = renderComposer({ streaming: false });
    type("touch draft");
    act(() => {
      composerButton("lucide-send").click();
    });
    expect(onSend).toHaveBeenCalledWith("touch draft", undefined);
  });
});
