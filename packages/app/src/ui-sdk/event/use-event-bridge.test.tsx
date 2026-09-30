import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useNavigate } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../lib/api";
import { useEventBridge } from "./use-event-bridge";

vi.mock("../../hooks/useBusSubscription", () => ({
  useBusSubscription: vi.fn(),
}));

function createClient(baseUrl: string): ApiClient {
  return { baseUrl } as unknown as ApiClient;
}

function subscribeNavigate(
  source: { postMessage: ReturnType<typeof vi.fn> },
  subscriptionId: string,
): void {
  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "spherse:event-subscribe", subscriptionId, event: "navigate" },
    origin: window.location.origin,
    source: source as unknown as MessageEventSource,
  }));
}

function Harness({ client }: { client: ApiClient | null }) {
  useEventBridge("p1", client);
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/project/p1/chat/s1")}>chat</button>
      <button onClick={() => navigate("/project/p1")}>home</button>
    </>
  );
}

describe("useEventBridge navigate", () => {
  it("dispatches navigate changes and re-seeds after a client rebuild", () => {
    const sourceA = { postMessage: vi.fn() };
    const sourceB = { postMessage: vi.fn() };
    const view = render(
      <MemoryRouter initialEntries={["/project/p1"]}>
        <Harness client={createClient("http://a.test")} />
      </MemoryRouter>,
    );

    subscribeNavigate(sourceA, "s1");
    expect(sourceA.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "s1",
      payload: { kind: "welcome" },
    }, "*");

    fireEvent.click(screen.getByText("chat"));
    expect(sourceA.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "s1",
      payload: { kind: "chat", sessionId: "s1" },
    }, "*");

    view.rerender(
      <MemoryRouter initialEntries={["/project/p1/chat/s1"]}>
        <Harness client={createClient("http://b.test")} />
      </MemoryRouter>,
    );

    subscribeNavigate(sourceB, "s2");
    expect(sourceB.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "s2",
      payload: { kind: "chat", sessionId: "s1" },
    }, "*");

    fireEvent.click(screen.getByText("home"));
    expect(sourceB.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "s2",
      payload: { kind: "welcome" },
    }, "*");
    expect(sourceA.postMessage).toHaveBeenCalledTimes(2);
  });
});
