import { app, dialog } from "electron";
import { createDesktopApp } from "./createDesktopApp.js";

if (process.env.FROSTPI_DESKTOP_PREVIEW_USER_DATA) app.setPath("userData", process.env.FROSTPI_DESKTOP_PREVIEW_USER_DATA);
app.on("window-all-closed", () => app.quit());
void app.whenReady().then(() => createDesktopApp({ directories: process.argv.slice(2).filter((argument) => !argument.startsWith("--")) })).catch(() => {
  dialog.showErrorBox("FrostPi Desktop", "The development preview could not start. No desktop configuration was changed.");
  app.exit(1);
});
