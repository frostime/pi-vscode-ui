param([string]$ReadyPath, [string]$ResultPath, [string]$Expected)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
# Materialize the original formats before Desktop replaces the clipboard.
$saved = New-Object System.Windows.Forms.DataObject
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($original) { foreach ($format in $original.GetFormats($false)) { $data = $original.GetData($format, $false); if ($null -ne $data) { $saved.SetData($format, $false, $data) } } }
try {
  [IO.File]::WriteAllText($ReadyPath, 'ready')
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    if ([System.Windows.Forms.Clipboard]::GetText() -eq $Expected) { [IO.File]::WriteAllText($ResultPath, 'ok'); exit 0 }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Desktop native clipboard write did not arrive'
} finally {
  if ($original) { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true) }
  else { [System.Windows.Forms.Clipboard]::Clear() }
}
