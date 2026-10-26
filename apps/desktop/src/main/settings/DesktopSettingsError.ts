/** Only deliberately authored, value-free messages may cross the settings IPC boundary. */
export class DesktopSettingsError extends Error {}

export function settingsErrorMessage(error: unknown): string {
  return error instanceof DesktopSettingsError
    ? error.message
    : "The Desktop settings operation failed. Check the settings file and try again.";
}
