param([int]$OwnerProcessId, [ValidateSet('close','restore','state')] [string]$Action)
$ErrorActionPreference = 'Stop'
# Exercise only the owned application's window and tray restore handlers.
# Right-click menus and Exit confirmation are checked manually.
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
  public static string Class(IntPtr h) { var text=new StringBuilder(256); GetClassName(h,text,256); return text.ToString(); }
  public static string Text(IntPtr h) { var text=new StringBuilder(256); GetWindowText(h,text,256); return text.ToString(); }
  public static IntPtr Find(int owner, string kind) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((h,d)=>{ uint id; GetWindowThreadProcessId(h,out id);
      if(id!=owner) return true;
      var cls=Class(h);
      if((kind=="main" && Text(h)=="FrostPi Desktop" && cls!="#32770") || (kind=="tray" && cls=="tray_icon_app") || (kind=="dialog" && cls=="#32770" && IsWindowVisible(h))) { found=h; return false; }
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
  @{ visible=[FrostPiNativeWindow]::IsWindowVisible($window); minimized=[FrostPiNativeWindow]::IsIconic($window); tray=$true; dialogTitle=[FrostPiNativeWindow]::Text($dialog) } | ConvertTo-Json -Compress
  return
}
if ($Action -eq 'close') {
  if (-not [FrostPiNativeWindow]::PostMessage($window, 16, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }
  return
}
# tray-icon 0.25.1 (Cargo.lock): message 6002 carries shell notifications;
# WM_LBUTTONUP exercises Tauri's actual restore callback without opening a menu.
if (-not [FrostPiNativeWindow]::PostMessage($tray, 6002, [IntPtr]::Zero, [IntPtr]514)) { throw 'Tray restore notification failed' }
