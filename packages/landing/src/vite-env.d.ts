/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OSS_MANIFEST_URL?: string;
  readonly VITE_OSS_PUBLIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
