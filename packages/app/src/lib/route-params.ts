export const MESSAGE_ID_PARAM = "messageId";

export function parseMessageIdParam(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function stripMessageId(pathname: string, search: string): string {
  if (!search.includes(`${MESSAGE_ID_PARAM}=`)) return `${pathname}${search}`;
  const params = new URLSearchParams(search);
  params.delete(MESSAGE_ID_PARAM);
  const next = params.toString();
  return next ? `${pathname}?${next}` : pathname;
}
