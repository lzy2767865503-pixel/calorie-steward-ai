param(
  [Parameter(Mandatory = $true)]
  [string]$StateDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'cleanup-store-test-candidate.ps1 must run on Windows.' }
$RunnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$StateRoot = [IO.Path]::GetFullPath($StateDirectory).TrimEnd('\')
$StateParent = [IO.Directory]::GetParent($StateRoot).FullName.TrimEnd('\')
if (-not [string]::Equals($StateParent, $RunnerTemp, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $StateRoot) -notlike 'calorie-store-signing-*') {
  throw 'Refusing to clean anything except a direct calorie-store-signing-* child of RUNNER_TEMP.'
}
if (-not (Test-Path -LiteralPath $StateRoot -PathType Container)) {
  Write-Host 'No Store QA signing state remains to clean.'
  return
}

$Reparse = @(
  Get-Item -LiteralPath $StateRoot -Force
  Get-ChildItem -LiteralPath $StateRoot -Recurse -Force
) | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
if ($Reparse.Count -gt 0) { throw 'Store QA signing state contains a reparse point.' }
& icacls.exe $StateRoot /inheritance:e /grant:r "$($env:USERNAME):(OI)(CI)(F)" /t /c | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restore cleanup access to Store QA signing state.' }

$StatePath = Join-Path $StateRoot 'state.json'
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  throw 'Store QA signing state exists without state.json; refusing unverifiable cleanup.'
}
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$ExpectedProperties = @(
  'certificateKeyName', 'certificateKeyProvider', 'certificateThumbprint', 'publisher',
  'schemaVersion', 'signedAppxPath', 'signedAppxSha256', 'signToolFileVersion',
  'signToolSha256', 'sourceAppxPath', 'sourceAppxSha256'
) | Sort-Object
$ActualProperties = @($State.PSObject.Properties.Name) | Sort-Object
if ((Compare-Object $ExpectedProperties $ActualProperties) -or
    [int]$State.schemaVersion -ne 2 -or
    [string]$State.publisher -cne 'CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8' -or
    [string]$State.certificateThumbprint -cnotmatch '^[0-9A-Fa-f]{40,64}$' -or
    [string]$State.certificateKeyName -notmatch '^[A-Za-z0-9{}._-]+$' -or
    [string]::IsNullOrWhiteSpace([string]$State.certificateKeyProvider) -or
    [string]$State.signedAppxSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    [string]$State.signToolSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    [string]::IsNullOrWhiteSpace([string]$State.signToolFileVersion) -or
    [string]$State.sourceAppxSha256 -cnotmatch '^[0-9a-f]{64}$') {
  throw 'Store QA signing state schema or ownership fields are invalid.'
}
$SignedAppx = [IO.Path]::GetFullPath([string]$State.signedAppxPath)
if (-not [string]::Equals((Split-Path -Parent $SignedAppx), $StateRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $SignedAppx) -cne 'sideload-test.appx') {
  throw 'Store QA signed AppX escaped its exact signing state root.'
}

$CleanupErrors = [Collections.Generic.List[string]]::new()
try {
  if (-not (Test-Path -LiteralPath $SignedAppx -PathType Leaf) -or
      (Get-FileHash -LiteralPath $SignedAppx -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        [string]$State.signedAppxSha256) {
    $CleanupErrors.Add('Frozen Store QA signed AppX is missing or changed.')
  }
} catch { $CleanupErrors.Add("Could not verify frozen signed AppX: $($_.Exception.Message)") }

$Thumbprint = [string]$State.certificateThumbprint
foreach ($Entry in @(
  @{ Path = "Cert:\CurrentUser\My\$Thumbprint"; DeleteKey = $true },
  @{ Path = "Cert:\CurrentUser\TrustedPeople\$Thumbprint"; DeleteKey = $false }
)) {
  try {
    if (Test-Path -LiteralPath $Entry.Path) {
      $Certificate = Get-Item -LiteralPath $Entry.Path
      if ($Certificate.Subject -cne [string]$State.publisher) {
        throw "certificate subject is '$($Certificate.Subject)'"
      }
      if ($Entry.DeleteKey) {
        Remove-Item -LiteralPath $Entry.Path -DeleteKey -Force
      } else {
        Remove-Item -LiteralPath $Entry.Path -Force
      }
    }
    if (Test-Path -LiteralPath $Entry.Path) { throw 'certificate remained' }
  } catch { $CleanupErrors.Add("Temporary certificate cleanup failed: $($Entry.Path) ($($_.Exception.Message))") }
}
foreach ($StorePath in @('Cert:\CurrentUser\My', 'Cert:\CurrentUser\TrustedPeople')) {
  try {
    if (@(Get-ChildItem -LiteralPath $StorePath -ErrorAction Stop | Where-Object {
          $_.Subject -ceq [string]$State.publisher
        }).Count -gt 0) {
      $CleanupErrors.Add("A certificate for the temporary Partner publisher remained in $StorePath.")
    }
  } catch {
    $CleanupErrors.Add("Could not complete publisher-certificate residue check in ${StorePath}: $($_.Exception.Message)")
  }
}

$KeyProbe = $null
try {
  $Provider = [Security.Cryptography.CngProvider]::new([string]$State.certificateKeyProvider)
  $KeyProbe = [Security.Cryptography.CngKey]::Open(
    [string]$State.certificateKeyName,
    $Provider,
    [Security.Cryptography.CngKeyOpenOptions]::UserKey
  )
  $CleanupErrors.Add('Temporary certificate private key remained in the CurrentUser CNG provider.')
} catch [Security.Cryptography.CryptographicException] {
  # Expected: removing CurrentUser\My with -DeleteKey deleted the exact key.
} catch {
  $CleanupErrors.Add("Could not prove temporary CNG private-key deletion: $($_.Exception.Message)")
} finally {
  if ($KeyProbe) { $KeyProbe.Dispose() }
}

if ($CleanupErrors.Count -eq 0) {
  Remove-Item -LiteralPath $StateRoot -Recurse -Force
  if (Test-Path -LiteralPath $StateRoot) { $CleanupErrors.Add('Store QA signing state root remained.') }
}
if ($CleanupErrors.Count -gt 0) { throw ($CleanupErrors -join [Environment]::NewLine) }
Write-Host 'Removed the one-time Store QA certificate, private key, and signed AppX.'
