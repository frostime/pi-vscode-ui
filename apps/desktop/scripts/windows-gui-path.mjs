import { existsSync } from "node:fs";
import { join } from "node:path";

import { powerShellLiteral, runPowerShell } from "./powershell.mjs";

/**
 * A normal Explorer or Start-menu start receives the PATH of a fresh logon: the
 * machine configuration first, then the user configuration, with `%references%`
 * expanded. This reconstructs that configured path without borrowing the
 * environment of the process running the check: both Path values are read
 * unexpanded, and references are resolved from Windows known folders and the
 * matching machine/user registry values. A running Explorer session can still
 * hold an older value, so this does not claim to reproduce one specific session.
 */
const rawPathScript = String.raw`$ErrorActionPreference = 'Stop'
function Read-RawPath([string]$hive, [string]$subKey, [string]$name) {
  $root = if ($hive -eq 'CurrentUser') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
  $key = $root.OpenSubKey($subKey)
  if ($null -eq $key) { return $null }
  try { return $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
  finally { $key.Close() }
}
$folders = [ordered]@{
  windows = [Environment]::GetFolderPath('Windows')
  programFiles = [Environment]::GetFolderPath('ProgramFiles')
  programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
  commonProgramFiles = [Environment]::GetFolderPath('CommonProgramFiles')
  commonProgramFilesX86 = [Environment]::GetFolderPath('CommonProgramFilesX86')
  commonApplicationData = [Environment]::GetFolderPath('CommonApplicationData')
  applicationData = [Environment]::GetFolderPath('ApplicationData')
  localApplicationData = [Environment]::GetFolderPath('LocalApplicationData')
  userProfile = [Environment]::GetFolderPath('UserProfile')
}
[pscustomobject]@{
  machine = Read-RawPath 'LocalMachine' 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment' 'Path'
  user = Read-RawPath 'CurrentUser' 'Environment' 'Path'
  folders = $folders
} | ConvertTo-Json -Compress -Depth 4`;

const expansionPasses = 5;
const registryLookupRounds = 3;
const defaultPathExtensions = ".COM;.EXE;.BAT;.CMD";

/** Reads the unexpanded original values of the named variables, user first. */
function registryVariablesScript(names) {
  return String.raw`$ErrorActionPreference = 'Stop'
function Read-RawValue([string]$hive, [string]$subKey, [string]$name) {
  $root = if ($hive -eq 'CurrentUser') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
  $key = $root.OpenSubKey($subKey)
  if ($null -eq $key) { return $null }
  try { return $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
  finally { $key.Close() }
}
$names = @(${names.map((name) => powerShellLiteral(name)).join(", ")})
$result = [ordered]@{}
foreach ($name in $names) {
  $result[$name] = [pscustomobject]@{
    user = Read-RawValue 'CurrentUser' 'Environment' $name
    machine = Read-RawValue 'LocalMachine' 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment' $name
  }
}
[pscustomobject]$result | ConvertTo-Json -Compress -Depth 4`;
}

function referencedNames(...values) {
  const names = new Set();
  for (const value of values) {
    for (const match of String(value ?? "").matchAll(/%([^%]+)%/g)) names.add(match[1]);
  }
  return names;
}

function driveOf(path) {
  return typeof path === "string" && /^[A-Za-z]:/.test(path) ? path.slice(0, 2) : undefined;
}

/** Ordinary Windows locations come from the shell's known folders, not from environment variables. */
function knownFolderVariables(folders) {
  const variables = new Map();
  const set = (name, value) => {
    if (typeof value === "string" && value.trim()) variables.set(name.toUpperCase(), value);
  };
  set("SystemRoot", folders.windows);
  set("WINDIR", folders.windows);
  set("SystemDrive", driveOf(folders.windows));
  set("ProgramFiles", folders.programFiles);
  set("ProgramFiles(x86)", folders.programFilesX86);
  set("CommonProgramFiles", folders.commonProgramFiles);
  set("CommonProgramFiles(x86)", folders.commonProgramFilesX86);
  set("ProgramData", folders.commonApplicationData);
  set("APPDATA", folders.applicationData);
  set("LOCALAPPDATA", folders.localApplicationData);
  set("USERPROFILE", folders.userProfile);
  set("HOMEDRIVE", driveOf(folders.userProfile));
  set("HOMEPATH", folders.userProfile ? folders.userProfile.slice(driveOf(folders.userProfile)?.length ?? 0) : undefined);
  return variables;
}

/**
 * Expands `%name%` references through a bounded number of passes. Unknown or
 * cyclic names stay literal and are reported; a self-referential value cannot
 * loop because each pass is counted.
 */
export function expandPathReferences(value, resolve, { passes = expansionPasses } = {}) {
  let expanded = String(value ?? "");
  const unresolved = new Set();
  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;
    expanded = expanded.replace(/%([^%]+)%/g, (match, name) => {
      const replacement = resolve(name);
      if (typeof replacement !== "string" || replacement.length === 0 || replacement === match) {
        unresolved.add(name);
        return match;
      }
      changed = true;
      return replacement;
    });
    if (!changed) break;
  }
  for (const match of expanded.matchAll(/%([^%]+)%/g)) unresolved.add(match[1]);
  return { expanded, unresolved: [...unresolved] };
}

/** Resolves a command the way Windows does: every PATH entry with every PATHEXT suffix. */
export function findOnPath(pathValue, command, extensions = defaultPathExtensions) {
  for (const directory of String(pathValue ?? "").split(";")) {
    const root = directory.trim().replace(/^"|"$/g, "");
    if (!root) continue;
    for (const extension of extensions.split(";")) {
      if (extension && existsSync(join(root, command + extension))) return root;
    }
  }
  return undefined;
}

export function configuredGuiPath() {
  const { machine, user, folders } = JSON.parse(runPowerShell(rawPathScript, { capture: true }));
  const variables = knownFolderVariables(folders ?? {});
  const referenced = referencedNames(machine, user);
  const registryValues = new Map();
  // Only names the configured PATH actually references are read, and each is read
  // unexpanded so nested references stay visible for the next bounded lookup.
  for (let round = 0; round < registryLookupRounds; round += 1) {
    const pending = [...referenced].filter((name) => !variables.has(name.toUpperCase()) && !registryValues.has(name.toUpperCase()));
    if (pending.length === 0) break;
    const fetched = JSON.parse(runPowerShell(registryVariablesScript(pending), { capture: true }));
    for (const name of pending) {
      const entry = fetched?.[name] ?? {};
      const value = typeof entry.user === "string" && entry.user.trim()
        ? entry.user
        : typeof entry.machine === "string" && entry.machine.trim() ? entry.machine : undefined;
      registryValues.set(name.toUpperCase(), value);
      for (const nested of referencedNames(entry.user, entry.machine)) referenced.add(nested);
    }
  }
  const resolve = (name) => {
    const key = name.toUpperCase();
    return variables.get(key) ?? registryValues.get(key);
  };
  const parts = [];
  const unresolvedReferences = new Set();
  for (const source of [machine, user]) {
    if (!String(source ?? "").trim()) continue;
    const result = expandPathReferences(source, resolve);
    for (const name of result.unresolved) unresolvedReferences.add(name);
    if (result.expanded.trim()) parts.push(result.expanded);
  }
  const value = parts.join(";");
  return {
    value,
    sources: ["machine Path", "user Path"],
    entryCount: value.split(";").filter((entry) => entry.trim()).length,
    unresolvedReferences: [...unresolvedReferences].sort(),
  };
}
