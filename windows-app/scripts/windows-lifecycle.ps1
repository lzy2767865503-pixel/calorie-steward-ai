param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,
  [ValidateRange(1, 2)]
  [int]$Round,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,
  [switch]$RequireTrustedLaiSignature,
  [switch]$PortableOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

if (-not $IsWindows) { throw "windows-lifecycle.ps1 must run on Windows." }
. (Join-Path $PSScriptRoot 'trusted-windows-sdk-tool.ps1')

$SignTool = $null
$SignToolHash = $null
$SignToolVersion = $null
if ($RequireTrustedLaiSignature) {
  $SignTool = Get-TrustedWindowsSdkTool -Name 'signtool.exe'
  $SignToolHash = (Get-FileHash -LiteralPath $SignTool.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $SignToolVersion = [string]$SignTool.VersionInfo.FileVersion
  if ([string]::IsNullOrWhiteSpace($SignToolVersion)) { throw 'Trusted signtool.exe has no file version.' }
}

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $ProjectRoot
$CandidateRoot = (Resolve-Path -LiteralPath $CandidateDirectory).Path
if (Test-Path -LiteralPath $EvidenceDirectory) {
  throw "Evidence directory already exists; refusing stale lifecycle evidence: $EvidenceDirectory"
}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$EvidenceRoot = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$ChecksumPath = Join-Path $CandidateRoot "SHA256SUMS.txt"
if (-not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
  throw "SHA256SUMS.txt is missing from the private in-job candidate directory."
}

function Get-FilePrefix {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateRange(1, 16)][int]$Length = 4
  )
  $Stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $Buffer = [byte[]]::new($Length)
    $Read = $Stream.Read($Buffer, 0, $Length)
    if ($Read -eq $Length) { return $Buffer }
    if ($Read -le 0) { return @() }
    return $Buffer[0..($Read - 1)]
  } finally {
    $Stream.Dispose()
  }
}

function Get-PeFiles {
  param([Parameter(Mandatory = $true)][string]$Root)
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File -Force | Where-Object {
      $Prefix = Get-FilePrefix -Path $_.FullName -Length 2
      $Prefix.Count -eq 2 -and $Prefix[0] -eq 0x4d -and $Prefix[1] -eq 0x5a
    }
  )
}

function Assert-NoNestedArchive {
  param([Parameter(Mandatory = $true)][string]$Root)
  foreach ($File in Get-ChildItem -LiteralPath $Root -Recurse -File -Force) {
    $Prefix = Get-FilePrefix -Path $File.FullName -Length 4
    if ($Prefix.Count -eq 4 -and $Prefix[0] -eq 0x50 -and $Prefix[1] -eq 0x4b -and
        $Prefix[2] -in @(0x03, 0x05, 0x07) -and $Prefix[3] -in @(0x04, 0x06, 0x08)) {
      throw "Portable package contains an unexpected nested ZIP container: $($File.FullName)"
    }
  }
}

function Assert-NoReparsePoints {
  param([Parameter(Mandatory = $true)][string]$Root)
  $ReparsePoints = @(
    Get-ChildItem -LiteralPath $Root -Recurse -Force | Where-Object {
      ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    }
  )
  if ($ReparsePoints.Count -gt 0) {
    throw "Candidate contains a symlink/junction/reparse point: $($ReparsePoints[0].FullName)"
  }
}

function Test-PathWithinRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )
  try {
    $NormalizedPath = [IO.Path]::GetFullPath($Path)
    $NormalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    return $NormalizedPath.StartsWith($NormalizedRoot, [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Expand-AsarsAndGetPeFiles {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ExtractionParent
  )
  $Results = @()
  $Asars = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter '*.asar' -Force)
  $Index = 0
  foreach ($Asar in $Asars) {
    $Destination = Join-Path $ExtractionParent "asar-$Label-$Index"
    New-Item -ItemType Directory -Path $Destination | Out-Null
    & node windows-app/node_modules/@electron/asar/bin/asar.js extract $Asar.FullName $Destination
    if ($LASTEXITCODE -ne 0) { throw "ASAR extraction failed: $($Asar.FullName)" }
    Assert-NoReparsePoints -Root $Destination
    Assert-NoNestedArchive -Root $Destination
    if (@(Get-ChildItem -LiteralPath $Destination -Recurse -File -Filter '*.asar' -Force).Count -gt 0) {
      throw "Nested ASAR containers are forbidden in the public candidate: $($Asar.FullName)"
    }
    $Results += @(Get-PeFiles -Root $Destination)
    $Index += 1
  }
  return @($Results)
}

function Get-EkuOids {
  param([Parameter(Mandatory = $true)]$Certificate)
  $Extension = $Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | Select-Object -First 1
  if (-not $Extension) { return @() }
  $Enhanced = [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
    $Extension,
    $Extension.Critical
  )
  return @($Enhanced.EnhancedKeyUsages | ForEach-Object { $_.Value })
}

function Assert-OnlineTrustedChain {
  param(
    [Parameter(Mandatory = $true)]$Certificate,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $Chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
  try {
    $Chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
    # Public roots are trust anchors and often do not publish revocation data.
    # Check the signer/TSA certificate and intermediates online, excluding only the root.
    $Chain.ChainPolicy.RevocationFlag = [Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
    $Chain.ChainPolicy.VerificationFlags = [Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
    $Chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(60)
    $Chain.ChainPolicy.DisableCertificateDownloads = $false
    if (-not $Chain.Build($Certificate)) {
      $Statuses = @($Chain.ChainStatus | ForEach-Object { $_.Status.ToString() }) -join ', '
      throw "$Label chain is not publicly trusted with online revocation checking: $Statuses"
    }
  } finally {
    $Chain.Dispose()
  }
}

function Assert-SignToolOutputPolicy {
  param(
    [Parameter(Mandatory = $true)][string]$CompactOutput,
    [Parameter(Mandatory = $true)][string]$VerboseOutput,
    [Parameter(Mandatory = $true)][string]$BinaryPath
  )
  $SignatureRows = [regex]::Matches(
    $CompactOutput,
    '(?im)^\s*(?<index>\d+)\s+(?<algorithm>sha(?:1|256|384|512))\s+(?<timestamp>\S+)\s*$'
  )
  if ($SignatureRows.Count -ne 1 -or
      $SignatureRows[0].Groups['index'].Value -cne '0' -or
      $SignatureRows[0].Groups['algorithm'].Value.ToLowerInvariant() -cne 'sha256' -or
      $SignatureRows[0].Groups['timestamp'].Value.ToUpperInvariant() -cne 'RFC3161') {
    throw "PE must contain exactly one SHA-256 signature with an RFC 3161 timestamp: $BinaryPath"
  }
  $SignatureIndexes = [regex]::Matches(
    $VerboseOutput,
    '(?im)^\s*Signature Index:\s*(?<index>\d+)(?:\s|$)'
  )
  if ($SignatureIndexes.Count -ne 1 -or
      $SignatureIndexes[0].Groups['index'].Value -cne '0') {
    throw "SignTool verbose verification did not prove exactly one embedded signature: $BinaryPath"
  }
  $FileHashRows = [regex]::Matches(
    $VerboseOutput,
    '(?im)^\s*Hash of file \((?<algorithm>[^)]+)\):\s*[0-9a-f]{64}\s*$'
  )
  if ($FileHashRows.Count -ne 1 -or
      $FileHashRows[0].Groups['algorithm'].Value.ToLowerInvariant() -cne 'sha256') {
    throw "SignTool did not prove exactly one SHA-256 Authenticode file digest: $BinaryPath"
  }
  $SuccessSummaries = [regex]::Matches(
    $VerboseOutput,
    '(?im)^\s*Number of (?:files|signatures) successfully Verified:\s*1\s*$'
  )
  if ($SuccessSummaries.Count -ne 1) {
    throw "SignTool did not prove exactly one successful embedded-signature verification: $BinaryPath"
  }
  foreach ($RequiredSummary in @(
    '(?im)^\s*Number of warnings:\s*0\s*$',
    '(?im)^\s*Number of errors:\s*0\s*$'
  )) {
    if ($VerboseOutput -notmatch $RequiredSummary) {
      throw "SignTool did not return a warning-free verification summary: $BinaryPath"
    }
  }
}

function Invoke-BoundedSignToolVerify {
  param(
    [Parameter(Mandatory = $true)][string]$BinaryPath,
    [switch]$Verbose
  )
  if (-not $SignTool) { throw "SignTool is unavailable for trusted signature verification." }

  $Arguments = [Collections.Generic.List[string]]::new()
  foreach ($Argument in @('verify', '/pa', '/all', '/tw')) { $Arguments.Add($Argument) }
  if ($Verbose) { $Arguments.Add('/v') }
  $Arguments.Add($BinaryPath)
  $StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $StartInfo.FileName = $SignTool.FullName
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  $StartInfo.RedirectStandardOutput = $true
  $StartInfo.RedirectStandardError = $true
  foreach ($Argument in $Arguments) {
    [void]$StartInfo.ArgumentList.Add($Argument)
  }
  $Process = [Diagnostics.Process]::new()
  $Process.StartInfo = $StartInfo
  try {
    if (-not $Process.Start()) { throw "SignTool verification did not start: $BinaryPath" }
    $StdOutTask = $Process.StandardOutput.ReadToEndAsync()
    $StdErrTask = $Process.StandardError.ReadToEndAsync()
    if (-not $Process.WaitForExit(180000)) {
      try { $Process.Kill($true) } catch {
        throw "SignTool timed out and its process tree could not be terminated: $BinaryPath"
      }
      if (-not $Process.WaitForExit(30000)) {
        throw "SignTool timed out and remained alive after process-tree termination: $BinaryPath"
      }
      throw "SignTool verification exceeded its 180 second hard timeout: $BinaryPath"
    }
    $Output = $StdOutTask.GetAwaiter().GetResult() + [Environment]::NewLine +
      $StdErrTask.GetAwaiter().GetResult()
    if ($Process.ExitCode -ne 0) {
      throw "SignTool rejected an embedded signature with exit code $($Process.ExitCode): $BinaryPath"
    }
    return $Output
  } finally {
    $Process.Dispose()
  }
}

function Assert-SingleSha256Rfc3161EmbeddedSignature {
  param([Parameter(Mandatory = $true)][string]$BinaryPath)
  $CompactOutput = Invoke-BoundedSignToolVerify -BinaryPath $BinaryPath
  $VerboseOutput = Invoke-BoundedSignToolVerify -BinaryPath $BinaryPath -Verbose
  Assert-SignToolOutputPolicy `
    -CompactOutput $CompactOutput `
    -VerboseOutput $VerboseOutput `
    -BinaryPath $BinaryPath
}

function Assert-TrustedLaiSignature {
  param([Parameter(Mandatory = $true)][string]$BinaryPath)
  Assert-SingleSha256Rfc3161EmbeddedSignature -BinaryPath $BinaryPath
  $Signature = Get-AuthenticodeSignature -LiteralPath $BinaryPath
  if ($Signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or -not $Signature.SignerCertificate) {
    throw "Trusted Authenticode signature is missing or invalid: $BinaryPath"
  }
  $Signer = $Signature.SignerCertificate
  $SimpleName = $Signer.GetNameInfo(
    [Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
    $false
  )
  if ($SimpleName -cnotin @('LAI ZEYU', '来泽宇')) {
    throw "Signer CN/SimpleName must be exactly LAI ZEYU or 来泽宇; found '$SimpleName'."
  }
  if ($script:TrustedSignerThumbprint -and $Signer.Thumbprint -cne $script:TrustedSignerThumbprint) {
    throw "Public candidate mixes multiple signer certificates: $BinaryPath"
  }
  if (-not $script:TrustedSignerThumbprint) {
    $script:TrustedSignerThumbprint = $Signer.Thumbprint
  }
  if ($Signer.Subject -ceq $Signer.Issuer) {
    throw "A self-issued signer certificate is forbidden: $BinaryPath"
  }
  if ('1.3.6.1.5.5.7.3.3' -notin @(Get-EkuOids -Certificate $Signer)) {
    throw "Signer certificate does not contain the Code Signing EKU: $BinaryPath"
  }
  if (-not $Signature.TimeStamperCertificate) {
    throw "Authenticode RFC 3161 timestamp is missing: $BinaryPath"
  }
  if ('1.3.6.1.5.5.7.3.8' -notin @(Get-EkuOids -Certificate $Signature.TimeStamperCertificate)) {
    throw "Timestamp certificate does not contain the Time Stamping EKU: $BinaryPath"
  }
  Assert-OnlineTrustedChain -Certificate $Signer -Label "Signer"
  Assert-OnlineTrustedChain -Certificate $Signature.TimeStamperCertificate -Label "Timestamp"
  return $SimpleName
}

function Invoke-BoundedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [ValidateRange(1, 1800)][int]$TimeoutSeconds = 300,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $StartInfo.FileName = $FilePath
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  foreach ($Argument in $Arguments) { [void]$StartInfo.ArgumentList.Add($Argument) }
  $Process = [Diagnostics.Process]::new()
  $Process.StartInfo = $StartInfo
  try {
    if (-not $Process.Start()) { throw "$Label did not start." }
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $Process.Kill($true) } catch {
        throw "$Label timed out and its process tree could not be terminated: $($_.Exception.Message)"
      }
      if (-not $Process.WaitForExit(30000)) {
        throw "$Label timed out and remained alive after process-tree termination."
      }
      throw "$Label exceeded its $TimeoutSeconds second hard timeout."
    }
    return $Process.ExitCode
  } finally {
    $Process.Dispose()
  }
}

function Get-ProductUninstallEntries {
  $Entries = @()
  foreach ($Root in @(
    'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )) {
    if (-not (Test-Path -LiteralPath $Root)) { continue }
    $Entries += @(Get-ChildItem -LiteralPath $Root -ErrorAction SilentlyContinue | Where-Object {
      $Properties = Get-ItemProperty -LiteralPath $_.PSPath -Name DisplayName -ErrorAction SilentlyContinue
      $Properties -and $Properties.DisplayName -ceq 'Calorie Steward by LAI ZEYU'
    })
  }
  return @($Entries)
}

function Get-ProductProcesses {
  return @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -ieq 'Calorie Steward by LAI ZEYU.exe'
    }
  )
}

function Get-CalorieListeners {
  return @(Get-NetTCPConnection -LocalPort 47823 -State Listen -ErrorAction SilentlyContinue)
}

function Wait-NoProductRuntime {
  param([ValidateRange(1, 60)][int]$TimeoutSeconds = 15)
  $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (@(Get-ProductProcesses).Count -eq 0 -and @(Get-CalorieListeners).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $Deadline)
  throw "Product process or loopback listener remained after bounded shutdown."
}

$SeenNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$ChecksumRecords = @()
foreach ($Line in Get-Content -LiteralPath $ChecksumPath) {
  if ($Line -notmatch '^([a-f0-9]{64})  ([^\\/]+)$') { throw "Invalid checksum line: $Line" }
  $ExpectedHash = $Matches[1]
  $FileName = $Matches[2]
  if (-not $SeenNames.Add($FileName)) { throw "Duplicate checksum entry: $FileName" }
  $FilePath = Join-Path $CandidateRoot $FileName
  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw "Candidate file is missing: $FileName" }
  $ActualHash = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualHash -cne $ExpectedHash) { throw "Candidate checksum mismatch: $FileName" }
  $ChecksumRecords += [pscustomobject]@{ Name = $FileName; Hash = $ActualHash; Path = $FilePath }
}

$Installers = @(Get-ChildItem -LiteralPath $CandidateRoot -File -Filter '*.exe')
$Archives = @(Get-ChildItem -LiteralPath $CandidateRoot -File -Filter '*.zip')
$Sboms = @(Get-ChildItem -LiteralPath $CandidateRoot -File -Filter '*.cdx.json')
if ($PortableOnly) {
  if ($Installers.Count -ne 0 -or $Archives.Count -ne 1 -or $Sboms.Count -ne 2 -or $ChecksumRecords.Count -ne 3) {
    throw "Portable public release expects one ZIP, two SBOMs, no installer, and three checksum records."
  }
} elseif ($Installers.Count -ne 1 -or $Archives.Count -ne 1 -or $Sboms.Count -ne 2 -or $ChecksumRecords.Count -ne 4) {
  throw "Private install QA expects one NSIS installer, one portable ZIP, two SBOMs, and four checksum records."
}
$ExpectedNames = @($Archives[0].Name) + @($Sboms.Name)
if (-not $PortableOnly) { $ExpectedNames += $Installers[0].Name }
if (Compare-Object ($ExpectedNames | Sort-Object) (@($ChecksumRecords.Name) | Sort-Object)) {
  throw "SHA256SUMS.txt does not cover the exact release-candidate inventory."
}
$Installer = $(if ($PortableOnly) { $null } else { $Installers[0] })
$Archive = $Archives[0]
$InstallerHashBefore = $(if ($Installer) {
  (Get-FileHash -LiteralPath $Installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
} else { $null })
$ArchiveHashBefore = (Get-FileHash -LiteralPath $Archive.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

$script:TrustedSignerThumbprint = $null
$VerifiedSigner = $null
if ($Installer) {
  $InstallerSignature = Get-AuthenticodeSignature -LiteralPath $Installer.FullName
  if ($RequireTrustedLaiSignature) {
    $VerifiedSigner = Assert-TrustedLaiSignature -BinaryPath $Installer.FullName
  } elseif ($InstallerSignature.Status -ne [Management.Automation.SignatureStatus]::NotSigned) {
    throw "Ordinary QA expects a private unsigned installer; public binaries use the separate trusted LAI ZEYU gate."
  }
}

$ProgramsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
$ExpectedInstallRoots = @(
  (Join-Path $ProgramsRoot 'Calorie Steward by LAI ZEYU'),
  (Join-Path $ProgramsRoot 'calorie-steward-windows')
)
$UserDataCandidates = @(
  (Join-Path $env:APPDATA 'Calorie Steward by LAI ZEYU'),
  (Join-Path $env:APPDATA 'calorie-steward-windows')
)
$ShortcutCandidates = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Calorie Steward by LAI ZEYU.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Calorie Steward by LAI ZEYU.lnk')
)
$ExistingInstalled = @()
if (Test-Path -LiteralPath $ProgramsRoot -PathType Container) {
  $ExistingInstalled = @(Get-ChildItem -LiteralPath $ProgramsRoot -Recurse -File -Filter 'Calorie Steward by LAI ZEYU.exe' -ErrorAction SilentlyContinue)
}
if ($ExistingInstalled.Count -gt 0 -or
    @($ExpectedInstallRoots | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or
    @($UserDataCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or
    @($ShortcutCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or
    @(Get-ProductUninstallEntries).Count -gt 0 -or
    @(Get-ProductProcesses).Count -gt 0 -or
    @(Get-CalorieListeners).Count -gt 0) {
  throw "Runner is not clean; refusing to overwrite an existing install, process, listener, shortcut, registry entry, or user-data directory."
}

$WorkRoot = Join-Path $env:RUNNER_TEMP "calorie-windows-round-$Round-$([Guid]::NewGuid().ToString('N'))"
$Unpacked = Join-Path $WorkRoot 'unpacked'
$InstalledExe = $null
$OwnedInstallRoot = $null
$Uninstaller = $null
$InstallAttempted = $false
$CreatedUserData = @()
$InstalledBinaries = @()
$PortableBinaries = @()
$PrimaryError = $null

function Invoke-PackagedUiSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Screenshot,
    [switch]$UseDefaultProfile,
    [string]$ExpectedUserData
  )
  $Nonce = [Guid]::NewGuid().ToString('N').ToLowerInvariant()
  $DebugPort = 49300 + ($Round * 10) + $(if ($UseDefaultProfile) { 2 } else { 1 })
  if (@(Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "Electron debugging port is already occupied: $DebugPort"
  }
  $env:CALORIE_ELECTRON_BINARY = $Executable
  $env:CALORIE_DEBUGGING_PORT = [string]$DebugPort
  $env:CALORIE_SMOKE_SCREENSHOT = $Screenshot
  $env:CALORIE_QA_NONCE = $Nonce
  if ($UseDefaultProfile) {
    $env:CALORIE_SMOKE_USE_DEFAULT_PROFILE = '1'
    $env:CALORIE_EXPECTED_USER_DATA = $ExpectedUserData
  }
  try {
    $PreviousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
    try {
      # Capture the smoke runner's own bounded diagnostic instead of allowing
      # PowerShell 7 to throw on the native exit code before it can be recorded.
      $PSNativeCommandUseErrorActionPreference = $false
      $SmokeOutput = @(& node windows-app/scripts/electron-smoke.cjs 2>&1)
      $SmokeExitCode = $LASTEXITCODE
    } finally {
      $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorPreference
    }
    if ($SmokeExitCode -ne 0) {
      $Diagnostic = ($SmokeOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
      if ($Diagnostic.Length -gt 4000) { $Diagnostic = $Diagnostic.Substring($Diagnostic.Length - 4000) }
      throw "Packaged Electron UI smoke failed with exit code $SmokeExitCode`: $Diagnostic"
    }
    foreach ($Line in $SmokeOutput) { Write-Host ([string]$Line) }
    if (-not (Test-Path -LiteralPath $Screenshot -PathType Leaf) -or (Get-Item -LiteralPath $Screenshot).Length -le 0) {
      throw "Packaged Electron UI smoke did not create a non-empty screenshot."
    }
    return $Nonce
  } finally {
    Remove-Item Env:\CALORIE_ELECTRON_BINARY -ErrorAction SilentlyContinue
    Remove-Item Env:\CALORIE_DEBUGGING_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:\CALORIE_SMOKE_SCREENSHOT -ErrorAction SilentlyContinue
    Remove-Item Env:\CALORIE_QA_NONCE -ErrorAction SilentlyContinue
    Remove-Item Env:\CALORIE_SMOKE_USE_DEFAULT_PROFILE -ErrorAction SilentlyContinue
    Remove-Item Env:\CALORIE_EXPECTED_USER_DATA -ErrorAction SilentlyContinue
  }
}

try {
  New-Item -ItemType Directory -Path $Unpacked | Out-Null
  Expand-Archive -LiteralPath $Archive.FullName -DestinationPath $Unpacked
  Assert-NoReparsePoints -Root $Unpacked
  Assert-NoNestedArchive -Root $Unpacked
  $PortableExecutables = @(
    Get-ChildItem -LiteralPath $Unpacked -Recurse -File -Filter 'Calorie Steward by LAI ZEYU.exe'
  )
  if ($PortableExecutables.Count -ne 1) { throw "Portable ZIP does not contain exactly one main executable." }
  $PortableBinaries = @(Get-PeFiles -Root $Unpacked)
  $PortableBinaries += @(Expand-AsarsAndGetPeFiles -Root $Unpacked -Label 'portable' -ExtractionParent $WorkRoot)
  if ($PortableBinaries.Count -lt 1) { throw "Portable ZIP contains no Windows PE binaries." }
  if ($RequireTrustedLaiSignature) {
    foreach ($PortableBinary in $PortableBinaries) {
      $PortableSigner = Assert-TrustedLaiSignature -BinaryPath $PortableBinary.FullName
      if ($VerifiedSigner -and $PortableSigner -cne $VerifiedSigner) {
        throw "Installer and portable PE signer names differ: $($PortableBinary.FullName)"
      }
      if (-not $VerifiedSigner) { $VerifiedSigner = $PortableSigner }
    }
  }
  Invoke-PackagedUiSmoke `
    -Executable $PortableExecutables[0].FullName `
    -Screenshot (Join-Path $EvidenceRoot 'portable-ui.png') | Out-Null
  Wait-NoProductRuntime

  if ($PortableOnly) {
    $ArchiveHashAfter = (Get-FileHash -LiteralPath $Archive.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ArchiveHashAfter -cne $ArchiveHashBefore) { throw "Portable candidate changed during round $Round." }
    [ordered]@{
      round = $Round
      mode = 'SIGNED-PORTABLE-PUBLIC-RELEASE'
      author = 'LAI ZEYU（来泽宇）'
      portableZipSha256 = $ArchiveHashAfter
      signerSimpleName = $VerifiedSigner
      signToolSha256 = $SignToolHash
      signToolFileVersion = $SignToolVersion
      portablePeCount = $PortableBinaries.Count
      processBoundNonce = 'PASS'
      portableUi = 'PASS'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'lifecycle.json') -Encoding UTF8
    Write-Host "Calorie Steward signed portable candidate round $Round passed."
    return
  }

  $InstallAttempted = $true
  $InstallExitCode = Invoke-BoundedProcess `
    -FilePath $Installer.FullName `
    -Arguments @('/S') `
    -TimeoutSeconds 300 `
    -Label 'NSIS installer'
  if ($InstallExitCode -ne 0) { throw "Silent NSIS install failed with exit code $InstallExitCode." }
  $InstalledExecutables = @(
    Get-ChildItem -LiteralPath $ProgramsRoot -Recurse -File -Filter 'Calorie Steward by LAI ZEYU.exe'
  )
  if ($InstalledExecutables.Count -ne 1) { throw "NSIS did not create exactly one expected installed executable." }
  $InstalledExe = $InstalledExecutables[0]
  $OwnedInstallRoot = $InstalledExe.Directory.FullName
  if (($InstalledExe.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Installed executable is a reparse point."
  }
  Assert-NoReparsePoints -Root $OwnedInstallRoot
  $ExactOwnedInstallRoot = [IO.Path]::GetFullPath($OwnedInstallRoot).TrimEnd('\')
  $CanonicalExpectedRoots = @($ExpectedInstallRoots | ForEach-Object {
    [IO.Path]::GetFullPath($_).TrimEnd('\')
  })
  if (@($CanonicalExpectedRoots | Where-Object {
        $_.Equals($ExactOwnedInstallRoot, [StringComparison]::OrdinalIgnoreCase)
      }).Count -ne 1 -or
      -not [IO.Path]::GetFullPath($InstalledExe.FullName).Equals(
        [IO.Path]::GetFullPath((Join-Path $ExactOwnedInstallRoot 'Calorie Steward by LAI ZEYU.exe')),
        [StringComparison]::OrdinalIgnoreCase
      )) {
    throw "Installed application is not the exact main executable in one canonical product root."
  }
  $Uninstallers = @(Get-ChildItem -LiteralPath $OwnedInstallRoot -File -Filter 'Uninstall*.exe')
  if ($Uninstallers.Count -ne 1) { throw "Installed NSIS uninstaller is missing or ambiguous." }
  $Uninstaller = $Uninstallers[0]
  $InstalledBinaries = @(Get-PeFiles -Root $OwnedInstallRoot)
  $InstalledBinaries += @(
    Expand-AsarsAndGetPeFiles -Root $OwnedInstallRoot -Label 'installed' -ExtractionParent $WorkRoot
  )
  if ($InstalledBinaries.Count -lt 2) { throw "Installed package must contain application and uninstaller PE binaries." }
  if ($RequireTrustedLaiSignature) {
    foreach ($InstalledBinary in $InstalledBinaries) {
      $InstalledSigner = Assert-TrustedLaiSignature -BinaryPath $InstalledBinary.FullName
      if ($InstalledSigner -cne $VerifiedSigner) {
        throw "Installed PE signer differs from the release candidate: $($InstalledBinary.FullName)"
      }
    }
  }

  $ExpectedUserData = Join-Path $env:APPDATA 'Calorie Steward by LAI ZEYU'
  $InstalledSmokeStartedUtc = [DateTime]::UtcNow
  $InstalledNonce = Invoke-PackagedUiSmoke `
    -Executable $InstalledExe.FullName `
    -Screenshot (Join-Path $EvidenceRoot 'installed-ui.png') `
    -UseDefaultProfile `
    -ExpectedUserData $ExpectedUserData
  $CreatedUserData = @($UserDataCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
  if ($CreatedUserData.Count -ne 1) { throw "Installed app did not create exactly one expected user-data directory." }
  $ReadyPath = Join-Path $CreatedUserData[0] 'ui_ready.json'
  if (-not (Test-Path -LiteralPath $ReadyPath -PathType Leaf)) { throw "Installed UI readiness evidence is missing." }
  $ReadyItem = Get-Item -LiteralPath $ReadyPath
  if ($ReadyItem.LastWriteTimeUtc -lt $InstalledSmokeStartedUtc.AddSeconds(-2)) {
    throw "Installed UI readiness evidence is stale."
  }
  $Ready = Get-Content -LiteralPath $ReadyPath -Raw | ConvertFrom-Json
  $InstalledExeHash = (Get-FileHash -LiteralPath $InstalledExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Ready.schemaVersion -ne 2 -or
      $Ready.product -cne 'Calorie Steward by LAI ZEYU' -or
      $Ready.author -cne 'LAI ZEYU（来泽宇）' -or
      $Ready.version -cne '1.2.3' -or
      $Ready.executableSha256 -cne $InstalledExeHash -or
      [IO.Path]::GetFullPath([string]$Ready.executablePath) -ine [IO.Path]::GetFullPath($InstalledExe.FullName) -or
      [int]$Ready.processId -le 0 -or
      $Ready.origin -cne 'http://127.0.0.1:47823' -or
      $Ready.qaNonce -cne $InstalledNonce -or
      $Ready.reactRootReady -ne $true -or
      $Ready.privacyEntryReady -ne $true) {
    throw "Installed UI evidence does not match the exact executable, process-bound nonce, and author."
  }
  Wait-NoProductRuntime

  $UninstallExitCode = Invoke-BoundedProcess `
    -FilePath $Uninstaller.FullName `
    -Arguments @('/S') `
    -TimeoutSeconds 300 `
    -Label 'NSIS uninstaller'
  if ($UninstallExitCode -ne 0) { throw "Silent uninstall failed with exit code $UninstallExitCode." }
  $CleanupDeadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    $CleanupComplete =
      -not (Test-Path -LiteralPath $InstalledExe.FullName) -and
      -not (Test-Path -LiteralPath $OwnedInstallRoot) -and
      @($CreatedUserData | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0 -and
      @(Get-ProductUninstallEntries).Count -eq 0 -and
      @($ShortcutCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0 -and
      @(Get-ProductProcesses).Count -eq 0 -and
      @(Get-CalorieListeners).Count -eq 0
    if ($CleanupComplete) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $CleanupDeadline)
  if (-not $CleanupComplete) {
    throw "Uninstall left executable, data, shortcut, registry, process, or listener residue."
  }
  $InstallAttempted = $false

  $InstallerHashAfter = (Get-FileHash -LiteralPath $Installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $ArchiveHashAfter = (Get-FileHash -LiteralPath $Archive.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($InstallerHashAfter -cne $InstallerHashBefore -or $ArchiveHashAfter -cne $ArchiveHashBefore) {
    throw "Candidate changed during lifecycle round $Round."
  }
  [ordered]@{
    round = $Round
    author = 'LAI ZEYU（来泽宇）'
    installerSha256 = $InstallerHashAfter
    portableZipSha256 = $ArchiveHashAfter
    installedExecutableSha256 = $InstalledExeHash
    signerSimpleName = $(if ($RequireTrustedLaiSignature) { $VerifiedSigner } else { 'PRIVATE-UNSIGNED-QA' })
    signToolSha256 = $(if ($RequireTrustedLaiSignature) { $SignToolHash } else { $null })
    signToolFileVersion = $(if ($RequireTrustedLaiSignature) { $SignToolVersion } else { $null })
    portablePeCount = $PortableBinaries.Count
    installedPeCount = $InstalledBinaries.Count
    processBoundNonce = 'PASS'
    portableUi = 'PASS'
    installedUi = 'PASS'
    uninstallDataRemoval = 'PASS'
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'lifecycle.json') -Encoding UTF8
  Write-Host "Calorie Steward candidate lifecycle round $Round passed."
} catch {
  $PrimaryError = $_
} finally {
  $CleanupErrors = [Collections.Generic.List[string]]::new()
  try {
    if ($InstallAttempted) {
    if (-not $OwnedInstallRoot) {
      $CreatedMainExecutables = @($ExpectedInstallRoots | ForEach-Object {
        $ExpectedMainExecutable = Join-Path $_ 'Calorie Steward by LAI ZEYU.exe'
        if (Test-Path -LiteralPath $ExpectedMainExecutable -PathType Leaf) {
          Get-Item -LiteralPath $ExpectedMainExecutable
        }
      })
      if ($CreatedMainExecutables.Count -eq 1) {
        $OwnedInstallRoot = $CreatedMainExecutables[0].Directory.FullName
      } else {
        $CreatedExpectedRoots = @($ExpectedInstallRoots | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
        if ($CreatedExpectedRoots.Count -eq 1) { $OwnedInstallRoot = $CreatedExpectedRoots[0] }
      }
    }
    $ValidatedCleanupRoot = $null
    if ($OwnedInstallRoot -and (Test-Path -LiteralPath $OwnedInstallRoot -PathType Container)) {
      try {
        $CandidateCleanupRoot = [IO.Path]::GetFullPath($OwnedInstallRoot).TrimEnd('\')
        $CanonicalExpectedRoots = @($ExpectedInstallRoots | ForEach-Object {
          [IO.Path]::GetFullPath($_).TrimEnd('\')
        })
        $ExactCleanupExe = Join-Path $CandidateCleanupRoot 'Calorie Steward by LAI ZEYU.exe'
        if (@($CanonicalExpectedRoots | Where-Object {
              $_.Equals($CandidateCleanupRoot, [StringComparison]::OrdinalIgnoreCase)
            }).Count -ne 1 -or
            -not (Test-Path -LiteralPath $ExactCleanupExe -PathType Leaf) -or
            ((Get-Item -LiteralPath $CandidateCleanupRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ((Get-Item -LiteralPath $ExactCleanupExe).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          $CleanupErrors.Add('Refused to own a noncanonical install root, missing main executable, or reparse point.')
        } else {
          Assert-NoReparsePoints -Root $CandidateCleanupRoot
          $ValidatedCleanupRoot = $CandidateCleanupRoot
        }
      } catch {
        $CleanupErrors.Add("Could not validate the product install root: $($_.Exception.Message)")
      }
    }
    $NamedProcesses = @(Get-ProductProcesses)
    if ($NamedProcesses.Count -gt 0 -and -not $ValidatedCleanupRoot) {
      $CleanupErrors.Add('Refused to terminate same-name processes without one validated product install root.')
    }
    foreach ($Process in $NamedProcesses) {
      $CurrentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($Process.ProcessId)" -ErrorAction SilentlyContinue
      if ($ValidatedCleanupRoot -and $CurrentProcess -and $CurrentProcess.ExecutablePath -and
          (Test-PathWithinRoot -Path $CurrentProcess.ExecutablePath -Root $ValidatedCleanupRoot)) {
        Stop-Process -Id $CurrentProcess.ProcessId -Force -ErrorAction SilentlyContinue
      } else {
        $CleanupErrors.Add("Refused to terminate an unowned or PID-reused same-name process: $($Process.ProcessId)")
      }
    }
    if ($NamedProcesses.Count -gt 0 -and $ValidatedCleanupRoot) {
      try { Wait-NoProductRuntime -TimeoutSeconds 30 } catch {
        $CleanupErrors.Add("Product runtime did not stop during cleanup: $($_.Exception.Message)")
      }
    }
    if (-not $Uninstaller -and $ValidatedCleanupRoot) {
      $PossibleUninstallers = @(Get-ChildItem -LiteralPath $ValidatedCleanupRoot -File -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue)
      if ($PossibleUninstallers.Count -eq 1) { $Uninstaller = $PossibleUninstallers[0] }
    }
    if ($Uninstaller -and (Test-Path -LiteralPath $Uninstaller.FullName -PathType Leaf)) {
      try {
        [void](Invoke-BoundedProcess -FilePath $Uninstaller.FullName -Arguments @('/S') -TimeoutSeconds 300 -Label 'cleanup uninstaller')
      } catch { Write-Warning $_.Exception.Message }
    }
    foreach ($UserDataPath in $UserDataCandidates) {
      if (Test-Path -LiteralPath $UserDataPath) {
        try {
          Remove-Item -LiteralPath $UserDataPath -Recurse -Force
        } catch {
          $CleanupErrors.Add("Could not remove product user data '$UserDataPath': $($_.Exception.Message)")
        }
      }
    }
    foreach ($ShortcutPath in $ShortcutCandidates) {
      if (Test-Path -LiteralPath $ShortcutPath) {
        try {
          Remove-Item -LiteralPath $ShortcutPath -Force
        } catch {
          $CleanupErrors.Add("Could not remove product shortcut '$ShortcutPath': $($_.Exception.Message)")
        }
      }
    }
    if ($ValidatedCleanupRoot -and (Test-Path -LiteralPath $ValidatedCleanupRoot)) {
      $LastRemovalError = $null
      foreach ($RemovalAttempt in 1..10) {
        try {
          Remove-Item -LiteralPath $ValidatedCleanupRoot -Recurse -Force
          $LastRemovalError = $null
          break
        } catch {
          $LastRemovalError = $_.Exception.Message
          Start-Sleep -Milliseconds (250 * $RemovalAttempt)
        }
      }
      if (Test-Path -LiteralPath $ValidatedCleanupRoot) {
        $CleanupErrors.Add("Could not validate or remove the product install root: $LastRemovalError")
      }
    }
      if (@(Get-ProductProcesses).Count -gt 0 -or @(Get-CalorieListeners).Count -gt 0 -or
          @(Get-ProductUninstallEntries).Count -gt 0 -or
          @($UserDataCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or
          @($ShortcutCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or
          @($ExpectedInstallRoots | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0 -or
          ($OwnedInstallRoot -and (Test-Path -LiteralPath $OwnedInstallRoot))) {
        $CleanupErrors.Add('Lifecycle failure cleanup left product-owned residue.')
      }
    }
  } catch {
    $CleanupErrors.Add("Unexpected product cleanup error: $($_.Exception.Message)")
  }
  if (Test-Path -LiteralPath $WorkRoot) {
    try {
      Remove-Item -LiteralPath $WorkRoot -Recurse -Force
    } catch {
      $CleanupErrors.Add("Could not remove lifecycle work directory: $($_.Exception.Message)")
    }
  }
  if (Test-Path -LiteralPath $WorkRoot) {
    $CleanupErrors.Add('Lifecycle work directory remained after cleanup.')
  }
  if ($CleanupErrors.Count -gt 0) {
    $PrimaryContext = $(if ($PrimaryError) {
      "Primary lifecycle failure: $($PrimaryError.Exception.Message). "
    } else { '' })
    throw "$($PrimaryContext)Lifecycle cleanup failed: $($CleanupErrors -join '; ')"
  }
}
if ($PrimaryError) { throw $PrimaryError }
