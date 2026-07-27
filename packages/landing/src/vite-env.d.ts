/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OSS_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
