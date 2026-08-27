function Assert-MicrosoftWindowsTool {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$KitsRoot,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $Tool = Get-Item -LiteralPath $Path -Force
  $Current = $Tool
  $ReachedRoot = $false
  while ($Current) {
    $CurrentPath = [IO.Path]::GetFullPath($Current.FullName).TrimEnd('\')
    if (($Current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "$Label path contains a reparse point."
    }
    if ([string]::Equals($CurrentPath, $KitsRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $ReachedRoot = $true
      break
    }
    $Current = $Current.Parent
  }
  if (-not $ReachedRoot -or $Tool.VersionInfo.CompanyName -cne 'Microsoft Corporation') {
    throw "$Label is outside the exact Windows Kits root or lacks Microsoft Corporation metadata."
  }

  $Signature = Get-AuthenticodeSignature -LiteralPath $Tool.FullName
  $SimpleName = if ($Signature.SignerCertificate) {
    $Signature.SignerCertificate.GetNameInfo(
      [Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
      $false
    )
  } else { '' }
  if ($Signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      -not $Signature.TimeStamperCertificate -or
      $SimpleName -cnotin @('Microsoft Windows', 'Microsoft Corporation')) {
    throw "$Label does not have the expected valid timestamped Microsoft Authenticode identity."
  }

  $Chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
  try {
    $Chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
    $Chain.ChainPolicy.RevocationFlag = [Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
    $Chain.ChainPolicy.VerificationFlags = [Security.Cryptography.X509Certificates.X509VerificationFlags]::IgnoreNotTimeValid
    $Chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(60)
    if (-not $Chain.Build($Signature.SignerCertificate)) {
      throw "$Label Microsoft signer chain did not pass online validation."
    }
  } finally {
    $Chain.Dispose()
  }
  return $Tool
}

function Get-TrustedWindowsSdkTool {
  param([Parameter(Mandatory = $true)][ValidateSet('makeappx.exe', 'signtool.exe')][string]$Name)

  $KitsRoot = [IO.Path]::GetFullPath(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10')
  ).TrimEnd('\')
  $EscapedName = [Regex]::Escape($Name)
  $Candidates = @(
    Get-ChildItem -LiteralPath (Join-Path $KitsRoot 'bin') -Filter $Name -File -Recurse -ErrorAction Stop |
      Where-Object { $_.FullName -match "\\bin\\\d+(?:\.\d+){3}\\x64\\$EscapedName$" } |
      Sort-Object { [version]$_.Directory.Parent.Name } -Descending
  )
  if ($Candidates.Count -eq 0) {
    throw "$Name was not found under a versioned Windows SDK x64 directory."
  }
  return Assert-MicrosoftWindowsTool -Path $Candidates[0].FullName -KitsRoot $KitsRoot -Label $Name
}

function Get-TrustedWindowsAppCertificationKit {
  $KitsRoot = [IO.Path]::GetFullPath(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10')
  ).TrimEnd('\')
  $AppCertPath = Join-Path $KitsRoot 'App Certification Kit\appcert.exe'
  if (-not (Test-Path -LiteralPath $AppCertPath -PathType Leaf)) {
    throw 'appcert.exe was not found at the exact Windows App Certification Kit path.'
  }
  return Assert-MicrosoftWindowsTool -Path $AppCertPath -KitsRoot $KitsRoot -Label 'appcert.exe'
}
