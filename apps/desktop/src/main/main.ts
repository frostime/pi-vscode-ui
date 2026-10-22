import { join } from "node:path";
import { app, dialog } from "electron";
import { createDesktopApp } from "./createDesktopApp.js";

app.setName("FrostPi");
app.setPath("userData", process.env.FROSTPI_DESKTOP_USER_DATA ?? join(app.getPath("appData"), "FrostPi"));
app.on("window-all-closed", () => app.quit());
void app.whenReady().then(() => createDesktopApp({ directories: process.argv.slice(2).filter((argument) => !argument.startsWith("--")) })).catch(() => {
  dialog.showErrorBox("FrostPi Desktop", "FrostPi Desktop could not start. Existing settings were not reset.");
  app.exit(1);
});
