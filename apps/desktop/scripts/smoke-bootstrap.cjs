// Install failure reporting before loading bundled application code, including its static imports.
const { writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { app } = require("electron");

function fail(error) {
  const message = error instanceof Error ? error.message : "Desktop smoke failed during startup.";
  writeFileSync(join(process.env.FROSTPI_DESKTOP_SMOKE_DIR, "result.json"), JSON.stringify({ ok: false, error: message }));
  console.error(message);
  app.exit(1);
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
try {
  require(resolve(process.argv[2]));
} catch (error) {
  fail(error);
}
