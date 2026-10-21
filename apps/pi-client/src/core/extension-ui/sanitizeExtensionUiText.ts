// Covers CSI, OSC, and common single-character terminal escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /[\u001B\u009B](?:(?:\][^\u0007]*(?:\u0007|\u001B\\))|(?:[[][0-?]*[ -/]*[@-~])|(?:[@-_]))/g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;

export function sanitizeExtensionUiText(value: string): string {
  return value.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
}
