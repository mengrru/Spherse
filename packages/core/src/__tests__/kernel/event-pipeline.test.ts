import { describe, expect, it, vi } from "vitest";
import { createEventPipeline, type EventMiddleware } from "../../kernel/event-pipeline.js";

describe("createEventPipeline", () => {
  it("passes events through middlewares in registration order before the sink", () => {
    const order: string[] = [];
    const mw = (name: string): EventMiddleware<number> => (event, next) => {
      order.push(`${name}:${event}`);
      next(event);
    };
    const dispatch = createEventPipeline([mw("a"), mw("b")], (e) => order.push(`sink:${e}`));

    dispatch(1);
    expect(order).toEqual(["a:1", "b:1", "sink:1"]);
  });

  it("short-circuits when a middleware does not call next", () => {
    const sink = vi.fn();
    const seen: string[] = [];
    const drop: EventMiddleware<number> = () => {
      seen.push("drop");
    };
    const after = (event: number, next: (e: number) => void) => {
      seen.push("after");
      next(event);
    };
    const dispatch = createEventPipeline([drop, after], sink);

    dispatch(1);
    expect(seen).toEqual(["drop"]);
    expect(sink).not.toHaveBeenCalled();
  });

  it("lets middlewares transform, drop, or multiply events", () => {
    const received: number[] = [];
    const double: EventMiddleware<number> = (event, next) => {
      if (event === 2) return;
      next(event * 10);
      next(event * 100);
    };
    const dispatch = createEventPipeline([double], (e) => received.push(e));

    dispatch(1);
    dispatch(2);
    expect(received).toEqual([10, 100]);
  });

  it("yields identity when no middleware is provided", () => {
    const sink = vi.fn();
    const dispatch = createEventPipeline([], sink);
    dispatch(7);
    expect(sink).toHaveBeenCalledWith(7);
  });
});
