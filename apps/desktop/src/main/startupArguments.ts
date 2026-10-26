/**
 * Directory arguments follow the application path in development (`electron . <dir>`)
 * but start right after the own executable in a packaged app (`FrostPi.exe <dir>`).
 * Electron reports the development launcher through `process.defaultApp`.
 */
export function startupDirectories(argv: readonly string[], defaultApp: boolean): string[] {
  return argv.slice(defaultApp ? 2 : 1).filter((argument) => !argument.startsWith("--"));
}
