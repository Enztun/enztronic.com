param(
  [Parameter(Mandatory)][string]$ConfigurationFile,
  [switch]$Apply,
  [switch]$Remove,
  [ValidateSet('gpt-6-luna')][string]$DraftModel = 'gpt-6-luna',
  [ValidateSet('gpt-6.1-sol', 'gpt-6-luna')][string]$PackageModel = 'gpt-6.1-sol',
  [ValidateSet('low', 'medium', 'high')][string]$ReasoningEffort = 'low'
)
# Owner-run in an elevated PowerShell 7. Adds or removes the Office worker's live OpenAI settings in
# its protected configuration file (the -ConfigurationFile the worker task already uses). The key is
# typed into a hidden prompt, validated, written atomically over the existing file so its access
# rules stay as they are, and never printed or logged. Without -Apply this only prints the plan.
# Restart the worker afterwards in an approved window; nothing here starts or stops a service.
$ErrorActionPreference = 'Stop'
$officePath = [IO.Path]::GetFullPath($ConfigurationFile)
if (!(Test-Path -LiteralPath $officePath -PathType Leaf)) { throw 'Configuration file not found.' }
$officeConfig = Get-Content -Raw -LiteralPath $officePath | ConvertFrom-Json -AsHashtable
if ($officeConfig -isnot [System.Collections.IDictionary] -or $officeConfig.OFFICE_ENABLED -cne 'true' -or $officeConfig.OFFICE_DEMO_WORKER -cne 'true' -or !$officeConfig.OFFICE_WORKER_DATABASE_URL) { throw 'This is not a reviewed Office worker configuration; nothing was changed.' }
$officeLiveKeys = @('OFFICE_LIVE_WORKER', 'OFFICE_OPENAI_API_KEY', 'OFFICE_OPENAI_DRAFT_MODEL', 'OFFICE_OPENAI_PACKAGE_MODEL', 'OFFICE_OPENAI_REASONING_EFFORT')
$officePlan = [ordered]@{ configurationFile = $officePath; action = $(if ($Remove) { 'remove_live_settings' } else { 'set_live_settings' }); keys = $officeLiveKeys; draftModel = $DraftModel; packageModel = $PackageModel; reasoningEffort = $ReasoningEffort; liveCurrentlyConfigured = $officeConfig.ContainsKey('OFFICE_LIVE_WORKER'); applied = $false }
if (!$Apply) { $officePlan | ConvertTo-Json; return }
foreach ($officeKey in $officeLiveKeys) { [void]$officeConfig.Remove($officeKey) }
if (!$Remove) {
  $officeSecure = Read-Host -AsSecureString -Prompt 'Office-only OpenAI API key (input hidden)'
  $officeBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($officeSecure)
  try { $officeKeyText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($officeBstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($officeBstr) }
  if ($officeKeyText -cnotmatch '^sk-[A-Za-z0-9_-]{20,400}$') { throw 'That does not look like an OpenAI API key; nothing was changed.' }
  $officeConfig.OFFICE_LIVE_WORKER = 'true'
  $officeConfig.OFFICE_OPENAI_API_KEY = $officeKeyText
  $officeConfig.OFFICE_OPENAI_DRAFT_MODEL = $DraftModel
  $officeConfig.OFFICE_OPENAI_PACKAGE_MODEL = $PackageModel
  $officeConfig.OFFICE_OPENAI_REASONING_EFFORT = $ReasoningEffort
}
# Create the temporary file with the original's private access rules before writing secrets.
# Its parent may have broader inherited access; protection prevents that access being added.
# File.Replace keeps the replaced file's access rules, without leaving a backup of old secrets.
$officeTemporaryAcl = [Security.AccessControl.FileSecurity]::new()
$officeOriginalAcl = Get-Acl -LiteralPath $officePath
$officeTemporaryAcl.SetSecurityDescriptorSddlForm($officeOriginalAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access), [Security.AccessControl.AccessControlSections]::Access)
$officeTemporaryAcl.SetAccessRuleProtection($true, $true)
$officeTemporary = "$officePath.$([guid]::NewGuid().ToString('N')).tmp"
$officeTemporaryStream = $null
try {
  $officeTemporaryStream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($officeTemporary), [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $officeTemporaryAcl)
  try {
    $officeBytes = [Text.UTF8Encoding]::new($false).GetBytes(($officeConfig | ConvertTo-Json -Depth 3))
    $officeTemporaryStream.Write($officeBytes, 0, $officeBytes.Length)
    $officeTemporaryStream.Flush($true)
  } finally {
    $officeTemporaryStream.Dispose()
    $officeTemporaryStream = $null
  }
  [IO.File]::Replace($officeTemporary, $officePath, [NullString]::Value)
} finally {
  if ($officeTemporaryStream) { $officeTemporaryStream.Dispose() }
  if (Test-Path -LiteralPath $officeTemporary) { Remove-Item -LiteralPath $officeTemporary -Force }
  $officeKeyText = $null
  $officeBytes = $null
  [void]$officeConfig.Remove('OFFICE_OPENAI_API_KEY')
  if ($officeSecure) { $officeSecure.Dispose() }
}
$officePlan.applied = $true
$officePlan | ConvertTo-Json
