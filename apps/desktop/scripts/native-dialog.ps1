param([int]$OwnerProcessId, [ValidateSet('cancel','accept','path')] [string]$Action, [string]$Value)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
# Only enumerate HWNDs owned by the launched test process.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class FrostPiNativeDialog {
  public delegate bool Visitor(IntPtr h, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visit, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visitor visit, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
  public static string Text(IntPtr h) { var text = new StringBuilder(512); GetWindowText(h, text, 512); return text.ToString(); }
  public struct Rect { public int Left, Top, Right, Bottom; }
  public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static void Click(IntPtr h) { Rect r; Point p; GetWindowRect(h,out r); GetCursorPos(out p); SetCursorPos((r.Left+r.Right)/2,(r.Top+r.Bottom)/2); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(100); SetCursorPos(p.X,p.Y); }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
  public static string Class(IntPtr h) { var text = new StringBuilder(256); GetClassName(h, text, 256); return text.ToString(); }
  public static IntPtr Find(int owner) { IntPtr dialog = IntPtr.Zero; EnumWindows((h,d)=>{ uint id; GetWindowThreadProcessId(h,out id); if(id==owner && Class(h)=="#32770" && IsWindowVisible(h)) {dialog=h;return false;} return true;},IntPtr.Zero); return dialog; }
  public static IntPtr[] Children(IntPtr parent) { var rows=new List<IntPtr>(); EnumChildWindows(parent,(h,d)=>{rows.Add(h);return true;},IntPtr.Zero); return rows.ToArray(); }
}
"@
[void][FrostPiNativeDialog]::SetProcessDPIAware()
$deadline = [DateTime]::UtcNow.AddSeconds(12)
do {
  $dialog = [FrostPiNativeDialog]::Find($OwnerProcessId)
  if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
} while ($dialog -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
if ($dialog -eq [IntPtr]::Zero) { throw 'The owned Desktop process opened no native dialog' }
$children = [FrostPiNativeDialog]::Children($dialog)
if ($Action -eq 'path') {
  $edits = @($children | Where-Object { [FrostPiNativeDialog]::Class($_) -eq 'Edit' -and [FrostPiNativeDialog]::IsWindowVisible($_) })
  $field = $edits | Where-Object { [FrostPiNativeDialog]::GetDlgCtrlID($_) -eq 1148 } | Select-Object -First 1
  if (-not $field) { $field = $edits | Select-Object -Last 1 }
  if (-not $field) { throw 'Native dialog has no visible file/folder name field' }
  [void][FrostPiNativeDialog]::SetForegroundWindow($dialog)
  Start-Sleep -Milliseconds 100
  if ([FrostPiNativeDialog]::GetForegroundWindow() -ne $dialog) { throw 'Interactive native-dialog tests require an unlocked foreground desktop' }
  [FrostPiNativeDialog]::Click($field)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  $escaped = $Value -replace '([+^%~()\[\]{}])', '{$1}'
  [System.Windows.Forms.SendKeys]::SendWait($escaped)

}
$id = if ($Action -eq 'cancel') { 2 } else { 1 }
$button = $children | Where-Object { [FrostPiNativeDialog]::Class($_) -eq 'Button' -and [FrostPiNativeDialog]::GetDlgCtrlID($_) -eq $id } | Select-Object -First 1
if (-not $button -and $Action -eq 'accept') { $button = $children | Where-Object { [FrostPiNativeDialog]::Class($_) -eq 'Button' -and [FrostPiNativeDialog]::GetDlgCtrlID($_) -eq 1000 } | Select-Object -First 1 }
if (-not $button) { throw "Native dialog has no expected action button: $Action" }
[void][FrostPiNativeDialog]::SetForegroundWindow($dialog)
[void][FrostPiNativeDialog]::PostMessage($button, 245, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 800
if ([FrostPiNativeDialog]::IsWindowVisible($dialog)) {
  $details = @($children | Where-Object { [FrostPiNativeDialog]::Class($_) -in @('Edit','Button') } | ForEach-Object { "$( [FrostPiNativeDialog]::Class($_) ):$( [FrostPiNativeDialog]::GetDlgCtrlID($_) ):$( [FrostPiNativeDialog]::Text($_) )" }) -join '; '
  throw "Native dialog did not close: $details"
}
