const OSS_BASE: string | undefined = import.meta.env.VITE_OSS_PUBLIC_BASE_URL;

export function sampleUrl(filename: string): string | undefined {
  return OSS_BASE ? `${OSS_BASE}/spherse/sample/${filename}` : undefined;
}
