import { describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { renderWithDataRouter } from "../../../test/render";
import { useLeaveGuard } from "./useLeaveGuard";

function Guarded({ dirty }: { dirty: boolean }) {
  const guard = useLeaveGuard(dirty);
  const location = useLocation();
  return (
    <div>
      <p data-testid="loc">{location.pathname + location.search}</p>
      {guard.open && (
        <div role="dialog">
          <button type="button" onClick={guard.confirm}>discard</button>
          <button type="button" onClick={() => guard.onOpenChange(false)}>keep</button>
        </div>
      )}
    </div>
  );
}

function Other() {
  const location = useLocation();
  return <p data-testid="other">{JSON.stringify(location.state)}</p>;
}

function setup(dirty: boolean) {
  return renderWithDataRouter(<Guarded dirty={dirty} />, {
    route: "/project/p1/content?path=a.md",
    routePath: "/project/:projectId/content",
    extraRoutes: [{ path: "/project/:projectId/chat/:sessionId", element: <Other /> }],
  });
}

describe("useLeaveGuard", () => {
  it("lets navigation through when not dirty", async () => {
    const { router } = setup(false);
    await act(() => router.navigate("/project/p1/chat/s1"));
    expect(screen.getByTestId("other")).toBeInTheDocument();
  });

  it("blocks navigation while dirty and stays put on cancel", async () => {
    const { router } = setup(true);
    await act(() => router.navigate("/project/p1/chat/s1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => screen.getByText("keep").click());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("loc")).toHaveTextContent("/project/p1/content?path=a.md");
  });

  it("proceeds with the original navigation state on confirm", async () => {
    const { router } = setup(true);
    await act(() => router.navigate("/project/p1/chat/s1", { state: { closeTab: "file:a.md" } }));
    await act(async () => screen.getByText("discard").click());

    expect(screen.getByTestId("other")).toHaveTextContent('{"closeTab":"file:a.md"}');
  });

  it("blocks switching to another file (search change)", async () => {
    const { router } = setup(true);
    await act(() => router.navigate("/project/p1/content?path=b.md"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("skips the guard when the navigation opts out", async () => {
    const { router } = setup(true);
    await act(() => router.navigate("/project/p1/chat/s1", { state: { skipLeaveGuard: true } }));
    expect(screen.getByTestId("other")).toBeInTheDocument();
  });
});
