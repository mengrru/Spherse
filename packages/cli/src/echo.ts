export const DEFAULT_FRONTEND_URL = "https://spherse.mengru.work/web/";

export interface LoginUrlInput {
  frontendUrl: string;
  baseUrl: string;
  token: string;
}

export function buildLoginUrl(input: LoginUrlInput): string {
  const frontend = `${input.frontendUrl.replace(/\/+$/, "")}/`;
  const params = new URLSearchParams({ base: input.baseUrl, token: input.token });
  return `${frontend}#/?${params.toString()}`;
}

export interface StartupEchoInput {
  endpoint: string;
  token: string;
  loginUrl: string;
}

export function renderStartupMessage(input: StartupEchoInput): string {
  return [
    "Spherse server running",
    "",
    `  Endpoint:  ${input.endpoint}`,
    `  Token:     ${input.token}`,
    "",
    "  Open in browser (login included):",
    `  ${input.loginUrl}`,
    "",
    "  Treat the token like a password. Do not share it.",
    "  First time? Configure a model API key in Settings after logging in.",
  ].join("\n");
}
