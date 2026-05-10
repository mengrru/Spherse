export function getAvatarColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = (hash * 31 + path.charCodeAt(i)) | 0;
  }

  hash = hash < 0 ? -hash : hash;

  const h = hash % 360;
  const s = 40 + (hash % 21);
  const l = 65 + ((hash >> 8) % 14);

  return `hsl(${h}, ${s}%, ${l}%)`;
}
