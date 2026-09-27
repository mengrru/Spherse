/* eslint-disable @typescript-eslint/no-unused-vars -- declaration merging for import.meta.env */
interface ImportMetaEnv {
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
/* eslint-enable @typescript-eslint/no-unused-vars */

const SITE_ORIGIN = "https://spherse.mengru.work";

const IS_DEV_CLIENT = import.meta.env.MODE === "development";

export const WEB_APP_URL = IS_DEV_CLIENT ? `${SITE_ORIGIN}/dev/web/` : `${SITE_ORIGIN}/web/`;
export const DOCS_URL = `${SITE_ORIGIN}/docs`;
export const EXPLORE_URL = `${SITE_ORIGIN}/explore`;
export const DOWNLOAD_PAGE_URL = `${SITE_ORIGIN}/`;
