export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, message);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

export class RuntimeClosedError extends HttpError {
  constructor(message = "Project runtime is not available") {
    super(404, message);
    this.name = "RuntimeClosedError";
  }
}

export class ChannelClosedError extends HttpError {
  constructor(message = "Chat channel is closed") {
    super(409, message);
    this.name = "ChannelClosedError";
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
