import { RpcAppError } from "./context.js";

export class RuntimeClosedError extends RpcAppError {
  readonly statusCode = 404;
  constructor(message = "Project runtime is not available") {
    super(100, message);
    this.name = "RuntimeClosedError";
  }
}

export class ChannelClosedError extends RpcAppError {
  readonly statusCode = 409;
  constructor(message = "Chat channel is closed") {
    super(102, message);
    this.name = "ChannelClosedError";
  }
}
