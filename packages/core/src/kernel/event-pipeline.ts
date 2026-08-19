export type EventMiddleware<T> = (event: T, next: (event: T) => void) => void;

export function createEventPipeline<T>(
  middlewares: ReadonlyArray<EventMiddleware<T>>,
  sink: (event: T) => void,
): (event: T) => void {
  const dispatch = (index: number, event: T): void => {
    if (index >= middlewares.length) {
      sink(event);
      return;
    }
    middlewares[index](event, (nextEvent: T) => dispatch(index + 1, nextEvent));
  };
  return (event: T) => dispatch(0, event);
}
