param(
  [Parameter(Mandatory = $true)]
  [string]$AppxPath,
  [Parameter(Mandatory = $true)]
  [string]$Publisher,
  [Parameter(Mandatory = $true)]
  [string]$StateDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

if (-not $IsWindows) { throw 'prepare-store-test-candidate.ps1 must run on Windows.' }
. (Join-Path $PSScriptRoot 'trusted-windows-sdk-tool.ps1')
if ($Publisher -cne 'CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8') {
  throw 'Temporary Store QA certificate must use the exact Partner Center publisher.'
}

$SourceAppx = (Resolve-Path -LiteralPath $AppxPath).Path
if ([IO.Path]::GetExtension($SourceAppx) -cne '.appx' -or
    (Get-AuthenticodeSignature -LiteralPath $SourceAppx).Status -ne
      [Management.Automation.SignatureStatus]::NotSigned) {
  throw 'Store QA preparation requires one unsigned Partner Center AppX.'
}
$SourceHash = (Get-FileHash -LiteralPath $SourceAppx -Algorithm SHA256).Hash.ToLowerInvariant()

$RunnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$StateRoot = [IO.Path]::GetFullPath($StateDirectory).TrimEnd('\')
$StateParent = [IO.Directory]::GetParent($StateRoot).FullName.TrimEnd('\')
if (-not [string]::Equals($StateParent, $RunnerTemp, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $StateRoot) -notlike 'calorie-store-signing-*') {
  throw 'StateDirectory must be a direct calorie-store-signing-* child of RUNNER_TEMP.'
}
if (Test-Path -LiteralPath $StateRoot) {
  throw 'Refusing to reuse a Store QA signing state directory.'
}

foreach ($StorePath in @('Cert:\CurrentUser\My', 'Cert:\CurrentUser\TrustedPeople')) {
  if (@(Get-ChildItem -LiteralPath $StorePath -ErrorAction SilentlyContinue | Where-Object {
        $_.Subject -ceq $Publisher
      }).Count -gt 0) {
    throw "Clean QA account required: the Partner publisher already exists in $StorePath."
  }
}

$SignTool = Get-TrustedWindowsSdkTool -Name 'signtool.exe'
$SignToolHash = (Get-FileHash -LiteralPath $SignTool.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$SignToolVersion = [string]$SignTool.VersionInfo.FileVersion
if ([string]::IsNullOrWhiteSpace($SignToolVersion)) { throw 'Trusted signtool.exe has no file version.' }

$SignedAppx = Join-Path $StateRoot 'sideload-test.appx'
$CerPath = Join-Path $StateRoot 'sideload-test.cer'
$StatePath = Join-Path $StateRoot 'state.json'
$Certificate = $null
$CertificateKeyName = $null
$CertificateKeyProvider = $null
$TrustedThumbprint = $null
$Succeeded = $false
New-Item -ItemType Directory -Path $StateRoot | Out-Null

try {
  Copy-Item -LiteralPath $SourceAppx -Destination $SignedAppx
  $Certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $Publisher `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy NonExportable `
    -KeyUsage DigitalSignature `
    -FriendlyName 'Calorie Steward CI sideload only' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter ([DateTime]::UtcNow.AddDays(2)) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  if ($Certificate.Subject -cne $Publisher -or $Certificate.Issuer -cne $Publisher) {
    throw 'Temporary certificate subject or issuer differs from the Partner publisher.'
  }
  $CertificatePrivateKey = $Certificate.GetRSAPrivateKey()
  try {
    if ($CertificatePrivateKey -isnot [Security.Cryptography.RSACng]) {
      throw 'Temporary certificate must use a deletable CurrentUser CNG private key.'
    }
    $CertificateKeyName = [string]$CertificatePrivateKey.Key.KeyName
    $CertificateKeyProvider = [string]$CertificatePrivateKey.Key.Provider.Provider
    if ([string]::IsNullOrWhiteSpace($CertificateKeyName) -or
        [string]::IsNullOrWhiteSpace($CertificateKeyProvider)) {
      throw 'Temporary certificate CNG key identity is unavailable.'
    }
  } finally {
    if ($CertificatePrivateKey) { $CertificatePrivateKey.Dispose() }
  }

  Export-Certificate -Cert $Certificate -FilePath $CerPath -Type CERT | Out-Null
  $Imported = @(Import-Certificate -FilePath $CerPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople')
  if ($Imported.Count -ne 1 -or $Imported[0].Thumbprint -cne $Certificate.Thumbprint -or
      $Imported[0].Subject -cne $Publisher) {
    throw 'Temporary certificate trust import is missing or ambiguous.'
  }
  $TrustedThumbprint = [string]$Imported[0].Thumbprint

  & $SignTool.FullName sign /sha1 $Certificate.Thumbprint /fd SHA256 /v $SignedAppx | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Temporary AppX signing failed with exit code $LASTEXITCODE." }
  $Signature = Get-AuthenticodeSignature -LiteralPath $SignedAppx
  if ($Signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      $Signature.SignerCertificate.Thumbprint -cne $Certificate.Thumbprint -or
      $Signature.SignerCertificate.Subject -cne $Publisher) {
    throw 'Temporary AppX signature does not use the exact ephemeral certificate.'
  }
  Remove-Item -LiteralPath $CerPath -Force
  if (Test-Path -LiteralPath $CerPath) { throw 'Exported temporary certificate file remained.' }

  $State = [ordered]@{
    schemaVersion = 2
    publisher = $Publisher
    sourceAppxPath = $SourceAppx
    sourceAppxSha256 = $SourceHash
    signedAppxPath = $SignedAppx
    signedAppxSha256 = (Get-FileHash -LiteralPath $SignedAppx -Algorithm SHA256).Hash.ToLowerInvariant()
    certificateThumbprint = [string]$Certificate.Thumbprint
    certificateKeyName = $CertificateKeyName
    certificateKeyProvider = $CertificateKeyProvider
    signToolFileVersion = $SignToolVersion
    signToolSha256 = $SignToolHash
  }
  $TemporaryStatePath = "$StatePath.tmp"
  $State | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $TemporaryStatePath -Encoding UTF8
  Move-Item -LiteralPath $TemporaryStatePath -Destination $StatePath
  & icacls.exe $StateRoot /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)(RX)" /t /c | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not freeze the one-time Store QA signing state read-only.' }
  $Succeeded = $true
  Write-Host "Prepared one frozen Store QA AppX for both WACK rounds: $($State.signedAppxSha256)"
} finally {
  if (-not $Succeeded) {
    $CleanupErrors = [Collections.Generic.List[string]]::new()
    foreach ($Thumbprint in @(
      $(if ($Certificate) { [string]$Certificate.Thumbprint } else { $null }),
      $TrustedThumbprint
    ) | Where-Object { $_ } | Select-Object -Unique) {
      foreach ($CertificatePath in @(
        "Cert:\CurrentUser\My\$Thumbprint",
        "Cert:\CurrentUser\TrustedPeople\$Thumbprint"
      )) {
        try {
          if (Test-Path -LiteralPath $CertificatePath) {
            if ($CertificatePath -like 'Cert:\CurrentUser\My\*') {
              Remove-Item -LiteralPath $CertificatePath -DeleteKey -Force
            } else {
              Remove-Item -LiteralPath $CertificatePath -Force
            }
          }
        } catch { $CleanupErrors.Add("Certificate cleanup failed: $CertificatePath ($($_.Exception.Message))") }
      }
    }
    try {
      if (Test-Path -LiteralPath $StateRoot) { Remove-Item -LiteralPath $StateRoot -Recurse -Force }
      if (Test-Path -LiteralPath $StateRoot) { throw 'state root remained' }
    } catch { $CleanupErrors.Add("Signing state cleanup failed: $($_.Exception.Message)") }
    if ($CleanupErrors.Count -gt 0) { throw ($CleanupErrors -join [Environment]::NewLine) }
  }
}
