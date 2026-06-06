import { app } from "electron";
import path from "node:path";

if (!app.isPackaged) {
  const defaultUserData = app.getPath("userData");
  app.setPath("userData", path.join(path.dirname(defaultUserData), "Spherse-Dev"));
}

import("./main.js");
