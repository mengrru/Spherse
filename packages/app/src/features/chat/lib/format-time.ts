export function formatMessageTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return hhmm;
  const mmdd = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  if (sameYear) return mmdd;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm}`;
}
