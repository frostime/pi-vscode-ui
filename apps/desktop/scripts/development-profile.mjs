import { join } from "node:path";

/** Only FrostPi storage changes. Pi settings, credentials, extensions and session roots stay inherited. */
export function developmentLaunchEnvironment(environment) {
  const profile = environment.FROSTPI_DESKTOP_USER_DATA || (environment.APPDATA && join(environment.APPDATA, "FrostPi-Dev"));
  if (!profile) throw new Error("Set APPDATA or FROSTPI_DESKTOP_USER_DATA before starting Desktop development.");
  return { ...environment, FROSTPI_DESKTOP_USER_DATA: profile };
}
