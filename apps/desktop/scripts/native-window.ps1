param([int]$OwnerProcessId, [ValidateSet('close','restore','exit','state')] [string]$Action, [int]$ExitCommandId = 0)
$ErrorActionPreference = 'Stop'
# Exercise the owned application's real native window/tray handlers, without adding renderer authority.
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FrostPiNativeWindow {
  public delegate bool Visitor(IntPtr h, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visit, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int position);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int size, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct TrayIdentifier { public uint cbSize; public IntPtr hWnd; public uint uID; public Guid guidItem; }
  [StructLayout(LayoutKind.Sequential)] public struct TrayRectangle { public int left, top, right, bottom; }
  [DllImport("shell32.dll")] static extern int Shell_NotifyIconGetRect(ref TrayIdentifier identifier, out TrayRectangle rectangle);
  public static int TrayRectResult(IntPtr h) {
    // Pinned Tauri 2.12.5 creates a default id first; tray-icon 0.25.1 then allocates native id 2.
    var identifier = new TrayIdentifier { cbSize=(uint)Marshal.SizeOf(typeof(TrayIdentifier)), hWnd=h, uID=2, guidItem=Guid.Empty };
    TrayRectangle rectangle;
    return Shell_NotifyIconGetRect(ref identifier, out rectangle);
  }
  public static string Class(IntPtr h) { var text=new StringBuilder(256); GetClassName(h,text,256); return text.ToString(); }
  public static string Text(IntPtr h) { var text=new StringBuilder(256); GetWindowText(h,text,256); return text.ToString(); }
  public static IntPtr Find(int owner, string kind) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((h,d)=>{ uint id; GetWindowThreadProcessId(h,out id);
      if(id!=owner) return true;
      var cls=Class(h);
      if((kind=="main" && Text(h)=="FrostPi Desktop" && cls!="#32770") || (kind=="tray" && cls=="tray_icon_app") || (kind=="menu" && cls=="#32768" && IsWindowVisible(h)) || (kind=="dialog" && cls=="#32770" && IsWindowVisible(h))) { found=h; return false; }
      return true;
    },IntPtr.Zero);
    return found;
  }
}
"@
$window = [FrostPiNativeWindow]::Find($OwnerProcessId, 'main')
$tray = [FrostPiNativeWindow]::Find($OwnerProcessId, 'tray')
if ($window -eq [IntPtr]::Zero -or $tray -eq [IntPtr]::Zero) { throw 'The owned Desktop process has no main window or tray icon' }
if ($Action -eq 'state') {
  $dialog = [FrostPiNativeWindow]::Find($OwnerProcessId, 'dialog')
  @{ visible=[FrostPiNativeWindow]::IsWindowVisible($window); minimized=[FrostPiNativeWindow]::IsIconic($window); tray=$true; trayRectResult=[FrostPiNativeWindow]::TrayRectResult($tray); dialogTitle=[FrostPiNativeWindow]::Text($dialog) } | ConvertTo-Json -Compress
  return
}
if ($Action -eq 'close') {
  if (-not [FrostPiNativeWindow]::PostMessage($window, 16, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }
  return
}
if ($Action -eq 'exit' -and $ExitCommandId -gt 0) {
  # Reuse the command discovered from this launch's real tray menu. Windows may later move the icon into overflow.
  if (-not [FrostPiNativeWindow]::PostMessage($tray, 273, [IntPtr]$ExitCommandId, [IntPtr]::Zero)) { throw 'Tray Exit command failed' }
  Write-Output $ExitCommandId
  return
}
# tray-icon 0.25.1 (Cargo.lock) uses message 6002 for Shell notifications.
# Sending the same button-up notifications exercises Tauri's actual tray callbacks.
$rectBefore = [FrostPiNativeWindow]::TrayRectResult($tray)
$button = if ($Action -eq 'restore') { 514 } else { 517 }
if (-not [FrostPiNativeWindow]::PostMessage($tray, 6002, [IntPtr]::Zero, [IntPtr]$button)) { throw 'Tray notification failed' }
if ($Action -eq 'restore') { return }
$deadline = [DateTime]::UtcNow.AddSeconds(8)
do {
  $popup = [FrostPiNativeWindow]::Find($OwnerProcessId, 'menu')
  if ($popup -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
} while ($popup -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
if ($popup -eq [IntPtr]::Zero) { throw "The owned tray icon opened no native menu; Shell_NotifyIconGetRect before=$rectBefore after=$([FrostPiNativeWindow]::TrayRectResult($tray))" }
$menu = [FrostPiNativeWindow]::SendMessage($popup, 481, [IntPtr]::Zero, [IntPtr]::Zero) # MN_GETHMENU
$command = $null
for ($i=0; $i -lt [FrostPiNativeWindow]::GetMenuItemCount($menu); $i++) {
  $text = New-Object System.Text.StringBuilder 256
  [void][FrostPiNativeWindow]::GetMenuString($menu, $i, $text, 256, 1024)
  if ($text.ToString().Replace('&','') -eq 'Exit') { $command=[FrostPiNativeWindow]::GetMenuItemID($menu,$i); break }
}
if ($null -eq $command) { throw 'The tray menu has no Exit command' }
# End the popup's modal loop, then activate the command through its real WM_COMMAND handler.
[void][FrostPiNativeWindow]::PostMessage($tray, 31, [IntPtr]::Zero, [IntPtr]::Zero) # WM_CANCELMODE
if (-not [FrostPiNativeWindow]::PostMessage($tray, 273, [IntPtr]$command, [IntPtr]::Zero)) { throw 'Tray Exit command failed' }
Write-Output $command
