const OSS_BASE: string | undefined = import.meta.env.VITE_OSS_PUBLIC_BASE_URL;

export interface ChangelogNote {
  type: string | null;
  text: string;
}

export interface ChangelogRelease {
  version: string;
  tag: string;
  date: string | null;
  notes: ChangelogNote[];
}

export interface Changelog {
  generatedAt: string;
  releases: ChangelogRelease[];
}

export async function fetchChangelog(): Promise<Changelog> {
  if (!OSS_BASE) throw new Error("VITE_OSS_PUBLIC_BASE_URL not configured");
  const res = await fetch(`${OSS_BASE}/spherse/changelog.json`);
  if (!res.ok) throw new Error(`changelog responded ${res.status}`);
  return (await res.json()) as Changelog;
}
