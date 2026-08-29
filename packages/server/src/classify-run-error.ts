import { ModelNotConfiguredError, ConflictError, ValidationError } from "@spherse/core";
import { ErrorEventCode } from "@spherse/contracts";

export function classifyRunError(err: unknown): ErrorEventCode {
  if (err instanceof ModelNotConfiguredError) return ErrorEventCode.ModelNotConfigured;
  if (err instanceof ConflictError || err instanceof ValidationError) {
    return ErrorEventCode.Permanent;
  }

  const status = readStatus(err);
  if (status !== undefined) {
    if (status === 401 || status === 403) return ErrorEventCode.Auth;
    if (status === 429 || status >= 500) return ErrorEventCode.Transient;
    if (status >= 400 && status < 500) return ErrorEventCode.Permanent;
  }

  if (isNetworkError(err)) return ErrorEventCode.Transient;

  return ErrorEventCode.Transient;
}

function readStatus(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") return status;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number") return statusCode;
  return undefined;
}

const NETWORK_PATTERNS = [
  /fetch failed/i,
  /networkerror/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /epipe/i,
  /und_err/i,
  /socket hang up/i,
];

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name ?? "";
  if (/error/i.test(name) && /timeout|network|connection/i.test(name)) return true;
  const message = err.message ?? "";
  return NETWORK_PATTERNS.some((re) => re.test(message) || re.test(name));
}
