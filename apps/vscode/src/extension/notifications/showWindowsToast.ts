import { execFile } from "node:child_process";

const WINDOWS_POWERSHELL_APP_USER_MODEL_ID = String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`;
const POWERSHELL_TIMEOUT_MS = 5_000;

export type WindowsToastProcessRunner = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean },
  callback: (error: Error | null) => void,
) => void;

export interface WindowsToastOptions {
  platform?: NodeJS.Platform;
  remoteName?: string;
  runProcess?: WindowsToastProcessRunner;
}

export function showWindowsToast(
  title: string,
  message: string,
  options: WindowsToastOptions = {},
): Promise<boolean> {
  if ((options.platform ?? process.platform) !== "win32" || options.remoteName !== undefined) {
    return Promise.resolve(false);
  }
  const encodedCommand = Buffer.from(windowsToastScript(title, message), "utf16le").toString("base64");
  const runProcess = options.runProcess ?? execFile;
  return new Promise((resolve) => {
    runProcess(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
      { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
      (error) => resolve(error === null),
    );
  });
}

function windowsToastScript(title: string, message: string): string {
  const encodedTitle = Buffer.from(title, "utf8").toString("base64");
  const encodedMessage = Buffer.from(message, "utf8").toString("base64");
  return String.raw`
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$title = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedTitle}'))
$message = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedMessage}'))
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName('text')
$texts.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
$texts.Item(1).AppendChild($template.CreateTextNode($message)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WINDOWS_POWERSHELL_APP_USER_MODEL_ID}').Show($toast)
`;
}
