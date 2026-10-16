"""Windows metadata/ACL helpers; no file contents, credentials or network access."""
import ctypes
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


def is_windows():
    return sys.platform == 'win32'


def hidden_process_options():
    return {'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)} if is_windows() else {}


def reject_reparse_path(path):
    """Reject every existing reparse point, including junctions and cloud links."""
    path = Path(path)
    for item in [path, *path.parents]:
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise ValueError('Private paths must not traverse reparse points')


def default_runtime_root():
    value = os.environ.get('LOCALAPPDATA')
    if not value or not Path(value).is_absolute():
        raise ValueError('An absolute LOCALAPPDATA directory is required')
    return Path(value) / 'EnztronicAudit'


def validate_windows_root(path):
    path = Path(path)
    # Network shares/device namespaces cannot provide the local NTFS contract.
    if len(path.drive) != 2 or path.drive[1] != ':' or not path.drive[0].isalpha():
        raise ValueError('Audit root must be on a local Windows drive')
    reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
    for part in path.parts[1:]:
        if (part.rstrip(' .') != part or part.split('.')[0].upper() in reserved
                or any(ord(character) < 32 or character in '<>:"|?*' for character in part)):
            raise ValueError('Audit root contains unsupported Windows path components')
    broad = [Path.home()]
    for name in ['LOCALAPPDATA', 'APPDATA', 'SystemRoot', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)']:
        if os.environ.get(name):
            broad.append(Path(os.environ[name]))
    resolved = path.resolve()
    if any(resolved == item.resolve() for item in broad):
        raise ValueError('Audit root must be a separate private directory')
    reject_reparse_path(path)


def _powershell_path():
    buffer = ctypes.create_unicode_buffer(32768)
    size = ctypes.windll.kernel32.GetSystemDirectoryW(buffer, len(buffer))
    if not size or size >= len(buffer):
        raise ValueError('Trusted Windows system directory is unavailable')
    return Path(buffer.value) / 'WindowsPowerShell/v1.0/powershell.exe'


# Paths arrive only as JSON on stdin, never as executable PowerShell fragments.
# New private directories have protected inheritable ACLs; children inherit only
# the current owner, SYSTEM and Administrators. Validation accepts this same set.
ACL_SCRIPT = r'''
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $inputObject = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $path = [string]$inputObject.path
  $operation = [string]$inputObject.operation
  if ($operation -notin @('directory', 'secure-file', 'validate-file')) { throw 'Invalid operation' }
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $allowed = @($current.Value, 'S-1-5-18', 'S-1-5-32-544')
  $item = Get-Item -LiteralPath $path -Force
  $cursor = $item
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }
    if ($cursor -is [IO.DirectoryInfo]) { $cursor = $cursor.Parent } else { $cursor = $cursor.Directory }
  }
  if ((New-Object IO.DriveInfo([IO.Path]::GetPathRoot($path))).DriveFormat -ne 'NTFS') { throw 'NTFS required' }
  if (($operation -eq 'directory') -ne $item.PSIsContainer) { throw 'Wrong file type' }
  $acl = Get-Acl -LiteralPath $path
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $current.Value) { throw 'Wrong owner' }
  if ($operation -ne 'validate-file') {
    # Retain untouched owner/audit/integrity sections. Replacing the complete
    # descriptor can require SeSecurityPrivilege on Python 3.13 temp folders.
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($oldRule in $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {
      $acl.RemoveAccessRuleSpecific($oldRule)
    }
    foreach ($identity in $allowed) {
      $sid = New-Object Security.Principal.SecurityIdentifier($identity)
      if ($item.PSIsContainer) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      } else {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
      }
      $acl.AddAccessRule($rule)
    }
    $item.SetAccessControl($acl)
  }
  $acl = Get-Acl -LiteralPath $path
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $current.Value) { throw 'Wrong owner' }
  $ownerFull = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow') { throw 'Unexpected access rule' }
    if ($rule.IdentityReference.Value -eq $current.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) { $ownerFull = $true }
  }
  if (-not $ownerFull) { throw 'Owner full control required' }
  if ($item.PSIsContainer -and -not $acl.AreAccessRulesProtected) { throw 'Inherited directory access' }
  [Console]::Out.Write('{"ok":true}')
} catch {
  [Console]::Out.Write('{"ok":false}')
  exit 1
}
'''


def _acl_operation(path, operation):
    reject_reparse_path(path)
    environment = {name: os.environ[name] for name in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA') if name in os.environ}
    try:
        completed = subprocess.run(
            [str(_powershell_path()), '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_SCRIPT],
            input=json.dumps({'path': str(Path(path).resolve()), 'operation': operation}),
            text=True, encoding='utf-8', capture_output=True, timeout=30, env=environment,
            **hidden_process_options())
        if completed.returncode or len(completed.stdout) > 128 or json.loads(completed.stdout) != {'ok': True}:
            raise ValueError('Private NTFS ACL validation failed')
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise ValueError('Private NTFS ACL validation failed') from error


def ensure_private_directory(path):
    path = Path(path)
    reject_reparse_path(path)
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise ValueError('Private path must be a directory')
    _acl_operation(path, 'directory')


def validate_private_file(path):
    path = Path(path)
    reject_reparse_path(path)
    if not path.is_file():
        raise ValueError('Private path must be a regular file')
    _acl_operation(path, 'validate-file')


def secure_private_file(path):
    path = Path(path)
    reject_reparse_path(path)
    if not path.is_file():
        raise ValueError('Private path must be a regular file')
    _acl_operation(path, 'secure-file')
