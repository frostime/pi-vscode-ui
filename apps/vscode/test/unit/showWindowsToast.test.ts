import { describe, expect, it, vi } from "vitest";

import { showWindowsToast, type WindowsToastProcessRunner } from "../../src/extension/notifications/showWindowsToast.js";

describe("Windows native notification", () => {
  it("passes notification text as encoded data without invoking a shell", async () => {
    const runProcess = vi.fn<WindowsToastProcessRunner>((_file, _args, _options, callback) => callback(null));
    const title = "FrostPi ' test";
    const message = "'; Start-Process calc; ' 中文";

    await expect(showWindowsToast(title, message, { platform: "win32", runProcess })).resolves.toBe(true);

    const [file, args, options] = runProcess.mock.calls[0]!;
    expect(file).toBe("powershell.exe");
    expect(args.slice(0, -1)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(options).toMatchObject({ timeout: 5_000, windowsHide: true });
    expect(options).not.toHaveProperty("shell");
    const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
    expect(script).not.toContain("Start-Process calc");
    expect(script).toContain(Buffer.from(title, "utf8").toString("base64"));
    expect(script).toContain(Buffer.from(message, "utf8").toString("base64"));
    expect(script).toContain(String.raw`CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe')`);
  });

  it("reports PowerShell failure to the caller", async () => {
    const runProcess = vi.fn<WindowsToastProcessRunner>((_file, _args, _options, callback) => {
      callback(new Error("PowerShell failed"));
    });

    await expect(showWindowsToast("FrostPi", "Waiting", { platform: "win32", runProcess })).resolves.toBe(false);
  });

  it("does not launch PowerShell outside a local Windows Extension Host", async () => {
    const runProcess = vi.fn<WindowsToastProcessRunner>();

    await expect(showWindowsToast("FrostPi", "Waiting", { platform: "linux", runProcess })).resolves.toBe(false);
    await expect(showWindowsToast("FrostPi", "Waiting", {
      platform: "win32",
      remoteName: "ssh-remote",
      runProcess,
    })).resolves.toBe(false);
    expect(runProcess).not.toHaveBeenCalled();
  });
});
