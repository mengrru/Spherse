import { ModelCatalog } from "@spherse/core";

let appCatalog: ModelCatalog | undefined;

export function getAppModelCatalog(): ModelCatalog {
  if (!appCatalog) {
    appCatalog = new ModelCatalog();
  }
  return appCatalog;
}
