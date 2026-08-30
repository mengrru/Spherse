import { ErrorEventCode } from "@spherse/contracts";

const PERMANENT_PATTERNS = [
  /prompt is too long/i,
  /context[_\s]?length[_\s]?exceeded/i,
  /exceeds.{0,12}(the )?(model'?s )?(maximum )?context/i,
  /context.{0,6}window.{0,6}(exceed|limit|long)/i,
  /request_too_large/i,
  /exceeded model token limit/i,
  /maximum context length/i,
  /reduce the length of the messages/i,
];

const TRANSIENT_PATTERNS = [
  /rate[\s-]?limit/i,
  /too many requests/i,
  /timeout|timed[\s-]?out/i,
  /networkerror/i,
  /fetch failed/i,
  /econnreset|econnrefused|etimedout|epipe/i,
  /socket hang up/i,
  /overloaded/i,
  /service unavailable/i,
  /bad gateway/i,
  /temporar(il)?y (unavailable|offline)/i,
  /try again/i,
];

const PERMANENT_HINT_PATTERNS = [
  /invalid (request|model)/i,
  /unsupported/i,
];

const AUTH_PATTERNS = [
  /unauthorized|forbidden/i,
  /invalid (api )?key/i,
  /\b401\b|\b403\b/,
  /authentication\s*(failed|required)/i,
];

export function classifyErrorMessageString(message: string): ErrorEventCode {
  if (!message) return ErrorEventCode.Transient;
  for (const re of AUTH_PATTERNS) {
    if (re.test(message)) return ErrorEventCode.Auth;
  }
  for (const re of PERMANENT_PATTERNS) {
    if (re.test(message)) return ErrorEventCode.Permanent;
  }
  for (const re of TRANSIENT_PATTERNS) {
    if (re.test(message)) return ErrorEventCode.Transient;
  }
  for (const re of PERMANENT_HINT_PATTERNS) {
    if (re.test(message)) return ErrorEventCode.Permanent;
  }
  return ErrorEventCode.Transient;
}
