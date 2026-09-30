import { Notification, ipcMain } from "electron";
import { showMainWindow } from "../tray.js";

export function registerNotificationsIpc(): void {
  ipcMain.handle(
    "notifications:show",
    (_event, request: { title: string; body: string }) => {
      if (!Notification.isSupported()) return;
      if (typeof request?.title !== "string" || typeof request?.body !== "string") return;
      const notification = new Notification({ title: request.title, body: request.body });
      notification.on("click", () => {
        void showMainWindow();
      });
      notification.show();
    },
  );
}
