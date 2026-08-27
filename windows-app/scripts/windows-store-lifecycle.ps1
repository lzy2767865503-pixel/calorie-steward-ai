param(
  [Parameter(Mandatory = $true)]
  [string]$AppxPath,
  [Parameter(Mandatory = $true)]
  [string]$IdentityName,
  [Parameter(Mandatory = $true)]
  [string]$Publisher,
  [Parameter(Mandatory = $true)]
  [string]$SigningStatePath,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2)]
  [int]$Round
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

if (-not $IsWindows) { throw "windows-store-lifecycle.ps1 must run on Windows." }
. (Join-Path $PSScriptRoot 'trusted-windows-sdk-tool.ps1')
$ExpectedIdentityName = 'LAIZEYU.CalorieStewardbyLAIZEYU'
if ($IdentityName -cne $ExpectedIdentityName) {
  throw "IdentityName must exactly match the reserved Calorie Steward Partner Center identity."
}
$ExpectedPublisher = 'CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8'
if ($Publisher -cne $ExpectedPublisher) {
  throw "Publisher must exactly match this Partner Center account's technical identity."
}

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $ProjectRoot
$OriginalAppx = (Resolve-Path -LiteralPath $AppxPath).Path
if ([IO.Path]::GetExtension($OriginalAppx) -cne '.appx') { throw "Store candidate must be one AppX file." }
if ((Get-AuthenticodeSignature -LiteralPath $OriginalAppx).Status -ne
    [Management.Automation.SignatureStatus]::NotSigned) {
  throw "Partner Center source AppX must remain unsigned; only the private sideload copy is test-signed."
}
if (Test-Path -LiteralPath $EvidenceDirectory) {
  throw "Evidence directory already exists; refusing stale Store evidence: $EvidenceDirectory"
}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$EvidenceRoot = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$OriginalHashBefore = (Get-FileHash -LiteralPath $OriginalAppx -Algorithm SHA256).Hash.ToLowerInvariant()
$SigningStateFile = (Resolve-Path -LiteralPath $SigningStatePath).Path
$SigningStateRoot = [IO.Path]::GetFullPath((Split-Path -Parent $SigningStateFile)).TrimEnd('\')
$RunnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$SigningStateParent = [IO.Directory]::GetParent($SigningStateRoot).FullName.TrimEnd('\')
if ((Split-Path -Leaf $SigningStateFile) -cne 'state.json' -or
    -not [string]::Equals($SigningStateParent, $RunnerTemp, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $SigningStateRoot) -notlike 'calorie-store-signing-*') {
  throw 'SigningStatePath must be state.json in a direct calorie-store-signing-* child of RUNNER_TEMP.'
}
$SigningStateReparseItems = @(
  Get-Item -LiteralPath $SigningStateRoot -Force
  Get-ChildItem -LiteralPath $SigningStateRoot -Recurse -Force
) | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
if ($SigningStateReparseItems.Count -gt 0) {
  throw 'Store QA signing state contains a reparse point.'
}
$SigningState = Get-Content -LiteralPath $SigningStateFile -Raw | ConvertFrom-Json
$ExpectedSigningStateProperties = @(
  'certificateKeyName', 'certificateKeyProvider', 'certificateThumbprint', 'publisher',
  'schemaVersion', 'signedAppxPath', 'signedAppxSha256', 'signToolFileVersion',
  'signToolSha256', 'sourceAppxPath', 'sourceAppxSha256'
) | Sort-Object
$ActualSigningStateProperties = @($SigningState.PSObject.Properties.Name) | Sort-Object
if ((Compare-Object $ExpectedSigningStateProperties $ActualSigningStateProperties) -or
    [int]$SigningState.schemaVersion -ne 2 -or
    [string]$SigningState.publisher -cne $Publisher -or
    [string]$SigningState.sourceAppxSha256 -cne $OriginalHashBefore -or
    [string]$SigningState.signedAppxSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    [string]$SigningState.signToolSha256 -cnotmatch '^[0-9a-f]{64}$' -or
    [string]::IsNullOrWhiteSpace([string]$SigningState.signToolFileVersion) -or
    [string]$SigningState.certificateThumbprint -cnotmatch '^[0-9A-F]{40,64}$' -or
    [string]$SigningState.certificateKeyName -notmatch '^[A-Za-z0-9{}._-]+$' -or
    [string]::IsNullOrWhiteSpace([string]$SigningState.certificateKeyProvider)) {
  throw 'Store QA signing state schema or ownership fields are invalid.'
}
$StateSourceAppx = [IO.Path]::GetFullPath([string]$SigningState.sourceAppxPath)
if (-not [string]::Equals($StateSourceAppx, $OriginalAppx, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Store QA signing state is bound to a different unsigned source AppX.'
}
$SignedCopy = [IO.Path]::GetFullPath([string]$SigningState.signedAppxPath)
if (-not [string]::Equals((Split-Path -Parent $SignedCopy), $SigningStateRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $SignedCopy) -cne 'sideload-test.appx' -or
    -not (Test-Path -LiteralPath $SignedCopy -PathType Leaf)) {
  throw 'Store QA signed AppX escaped or is missing from its exact signing state root.'
}
$ExpectedSignedHash = [string]$SigningState.signedAppxSha256
$CertificateThumbprint = [string]$SigningState.certificateThumbprint
$SignToolHash = [string]$SigningState.signToolSha256
$SignToolVersion = [string]$SigningState.signToolFileVersion
$SigningStateFileHash = (Get-FileHash -LiteralPath $SigningStateFile -Algorithm SHA256).Hash.ToLowerInvariant()
$SourceCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $SourceCommit -notmatch '^[a-f0-9]{40}$') { throw "Source commit could not be resolved." }

$PackagesRoot = Join-Path $env:LOCALAPPDATA 'Packages'
$FamilyPrefix = "$IdentityName`_"
$ExistingPackages = @(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue)
$ExistingFamilyRoots = @(
  Get-ChildItem -LiteralPath $PackagesRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.Name.StartsWith($FamilyPrefix, [StringComparison]::OrdinalIgnoreCase)
  }
)
$ExistingProductProcesses = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq 'Calorie Steward by LAI ZEYU.exe'
  }
)
$ExistingListeners = @(Get-NetTCPConnection -LocalPort 47823 -State Listen -ErrorAction SilentlyContinue)
if ($ExistingPackages.Count -gt 0 -or $ExistingFamilyRoots.Count -gt 0 -or
    $ExistingProductProcesses.Count -gt 0 -or $ExistingListeners.Count -gt 0) {
  throw "Refusing to replace or later clean a preexisting package, PFN data root, process, or loopback listener."
}
foreach ($StorePath in @('Cert:\CurrentUser\My', 'Cert:\CurrentUser\TrustedPeople')) {
  $SigningCertificates = @(
    Get-ChildItem -LiteralPath $StorePath -ErrorAction SilentlyContinue | Where-Object {
      $_.Subject -ceq $Publisher
    }
  )
  if ($SigningCertificates.Count -ne 1 -or
      $SigningCertificates[0].Thumbprint -cne $CertificateThumbprint -or
      ($StorePath -ceq 'Cert:\CurrentUser\My' -and -not $SigningCertificates[0].HasPrivateKey)) {
    throw "Store QA certificate is missing, ambiguous, or differs from the frozen signing state in $StorePath."
  }
}
$StoreRunStartedUtc = [DateTimeOffset]::UtcNow
$WindowsTempRoot = [IO.Path]::GetFullPath((Join-Path $env:WINDIR 'Temp')).TrimEnd('\')
$PreexistingAppCertRoots = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($ExistingRoot in @(
  Get-ChildItem -LiteralPath $WindowsTempRoot -Directory -Force -Filter 'appcert_*' -ErrorAction SilentlyContinue
)) {
  [void]$PreexistingAppCertRoots.Add([IO.Path]::GetFullPath($ExistingRoot.FullName).TrimEnd('\'))
}
if ($PreexistingAppCertRoots.Count -gt 0) {
  throw "Clean WACK runner required: preexisting appcert_* roots are forbidden and will not be deleted."
}

$CurrentSession = (Get-Process -Id $PID).SessionId
$InteractiveShell = @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $CurrentSession })
$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = [Security.Principal.WindowsPrincipal]::new($CurrentIdentity)
if (-not [Environment]::UserInteractive -or $CurrentSession -le 0 -or $InteractiveShell.Count -eq 0) {
  throw "WACK requires an active interactive Windows desktop; Session 0 and service-only runners are forbidden."
}
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "WACK runner must be elevated Administrator in the active desktop session."
}

$MakeAppx = Get-TrustedWindowsSdkTool -Name 'makeappx.exe'
$AppCertItem = Get-TrustedWindowsAppCertificationKit
$AppCert = $AppCertItem.FullName
$MakeAppxHash = (Get-FileHash -LiteralPath $MakeAppx.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$AppCertHash = (Get-FileHash -LiteralPath $AppCert -Algorithm SHA256).Hash.ToLowerInvariant()
$MakeAppxVersion = [string]$MakeAppx.VersionInfo.FileVersion
$AppCertVersion = [string]$AppCertItem.VersionInfo.FileVersion
if ([string]::IsNullOrWhiteSpace($MakeAppxVersion) -or [string]::IsNullOrWhiteSpace($AppCertVersion)) {
  throw 'Trusted Windows SDK/WACK tools must expose file versions.'
}

function Invoke-BoundedNativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [ValidateRange(1, 7200)][int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$LogPath
  )
  $StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $StartInfo.FileName = $FilePath
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  $StartInfo.RedirectStandardOutput = $true
  $StartInfo.RedirectStandardError = $true
  foreach ($Argument in $Arguments) { [void]$StartInfo.ArgumentList.Add($Argument) }
  $Process = [Diagnostics.Process]::new()
  $Process.StartInfo = $StartInfo
  $StartedUtc = [DateTime]::UtcNow
  $TimedOut = $false
  try {
    if (-not $Process.Start()) { throw "$Label did not start." }
    $StdOutTask = $Process.StandardOutput.ReadToEndAsync()
    $StdErrTask = $Process.StandardError.ReadToEndAsync()
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
      $TimedOut = $true
      try { $Process.Kill($true) } catch {
        throw "$Label timed out and its process tree could not be terminated: $($_.Exception.Message)"
      }
      if (-not $Process.WaitForExit(30000)) {
        throw "$Label timed out and remained alive after process-tree termination."
      }
    }
    $StdOut = $StdOutTask.GetAwaiter().GetResult()
    $StdErr = $StdErrTask.GetAwaiter().GetResult()
    @(
      "label=$Label",
      "startedUtc=$($StartedUtc.ToString('O'))",
      "finishedUtc=$([DateTime]::UtcNow.ToString('O'))",
      "timedOut=$TimedOut",
      "exitCode=$($Process.ExitCode)",
      '--- stdout ---',
      $StdOut,
      '--- stderr ---',
      $StdErr
    ) | Set-Content -LiteralPath $LogPath -Encoding UTF8
    if ($TimedOut) { throw "$Label exceeded its $TimeoutSeconds second hard timeout." }
    return $Process.ExitCode
  } finally {
    $Process.Dispose()
  }
}

function Test-PathWithinRoot {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root)
  $NormalizedPath = [IO.Path]::GetFullPath($Path)
  $NormalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  return $NormalizedPath.StartsWith($NormalizedRoot, [StringComparison]::OrdinalIgnoreCase)
}

function Test-IdentityOwnedExecutable {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)
  $WindowsAppsRoot = Join-Path $env:ProgramFiles 'WindowsApps'
  $NormalizedPath = [IO.Path]::GetFullPath($ExecutablePath)
  $NormalizedRoot = [IO.Path]::GetFullPath($WindowsAppsRoot).TrimEnd('\') + '\'
  if (-not $NormalizedPath.StartsWith($NormalizedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $Relative = $NormalizedPath.Substring($NormalizedRoot.Length)
  $PackageDirectory = $Relative.Split([IO.Path]::DirectorySeparatorChar, 2)[0]
  return $PackageDirectory.StartsWith($FamilyPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-TreeHasReparsePoint {
  param([Parameter(Mandatory = $true)][string]$Root)
  $RootItem = Get-Item -LiteralPath $Root -Force
  if (($RootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -Force | Where-Object {
      ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    }
  ).Count -gt 0
}

function Assert-FrozenSigningCandidate {
  if (Test-TreeHasReparsePoint -Root $SigningStateRoot) {
    throw 'Store QA signing state gained a reparse point.'
  }
  if (-not (Test-Path -LiteralPath $SigningStateFile -PathType Leaf) -or
      (Get-FileHash -LiteralPath $SigningStateFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        $SigningStateFileHash) {
    throw 'Frozen Store QA signing state changed during validation.'
  }
  if (-not (Test-Path -LiteralPath $SignedCopy -PathType Leaf) -or
      (Get-FileHash -LiteralPath $SignedCopy -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        $ExpectedSignedHash) {
    throw 'Frozen Store QA signed AppX changed during validation.'
  }
  $TemporarySignature = Get-AuthenticodeSignature -LiteralPath $SignedCopy
  if ($TemporarySignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      -not $TemporarySignature.SignerCertificate -or
      $TemporarySignature.SignerCertificate.Thumbprint -cne $CertificateThumbprint -or
      $TemporarySignature.SignerCertificate.Subject -cne $Publisher) {
    throw 'Frozen Store QA AppX signature differs from the one-time temporary certificate.'
  }
  foreach ($StorePath in @('Cert:\CurrentUser\My', 'Cert:\CurrentUser\TrustedPeople')) {
    $Matches = @(
      Get-ChildItem -LiteralPath $StorePath -ErrorAction SilentlyContinue | Where-Object {
        $_.Subject -ceq $Publisher
      }
    )
    if ($Matches.Count -ne 1 -or $Matches[0].Thumbprint -cne $CertificateThumbprint -or
        ($StorePath -ceq 'Cert:\CurrentUser\My' -and -not $Matches[0].HasPrivateKey)) {
      throw "One-time Store QA certificate changed or became ambiguous in $StorePath."
    }
  }
}

function Register-ExactAppCertInstallLocation {
  param(
    [Parameter(Mandatory = $true)][string]$PackageFullName,
    [Parameter(Mandatory = $true)][string]$RawInstallLocation,
    [switch]$AllowAlreadyRemoved
  )
  $InstallLocation = [IO.Path]::GetFullPath($RawInstallLocation).TrimEnd('\')
  $AppCertRoot = [IO.Directory]::GetParent($InstallLocation).FullName.TrimEnd('\')
  $Parent = [IO.Directory]::GetParent($AppCertRoot).FullName.TrimEnd('\')
  $AppCertLeaf = [IO.Path]::GetFileName($AppCertRoot)
  if (-not [string]::Equals($Parent, $WindowsTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      $AppCertLeaf -cnotmatch '^appcert_[A-Za-z0-9._-]+$' -or
      [IO.Path]::GetFileName($InstallLocation) -cne $PackageFullName -or
      $PackageFullName -cnotmatch "^$([regex]::Escape($IdentityName))_1\.2\.3\.0_x64__" -or
      $PreexistingAppCertRoots.Contains($AppCertRoot)) {
    throw "AppCert ownership does not resolve to a new exact candidate root."
  }
  if (Test-Path -LiteralPath $AppCertRoot -PathType Container) {
    $RootItem = Get-Item -LiteralPath $AppCertRoot -Force
    if ([DateTimeOffset]$RootItem.CreationTimeUtc -lt $StoreRunStartedUtc.AddSeconds(-2) -or
        [DateTimeOffset]$RootItem.LastWriteTimeUtc -lt $StoreRunStartedUtc.AddSeconds(-2)) {
      throw "Candidate AppCert root is stale."
    }
    if (Test-TreeHasReparsePoint -Root $AppCertRoot) {
      throw "Candidate AppCert root contains a reparse point."
    }
    $ManifestPath = Join-Path $InstallLocation 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
      throw "Candidate AppCert install root has no manifest."
    }
    [xml]$AppCertManifest = Get-Content -LiteralPath $ManifestPath -Raw
    $AppCertIdentity = $AppCertManifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
    $AppCertApplication = $AppCertManifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
    if (-not $AppCertIdentity -or
        $AppCertIdentity.GetAttribute('Name') -cne $IdentityName -or
        $AppCertIdentity.GetAttribute('Publisher') -cne $Publisher -or
        $AppCertIdentity.GetAttribute('Version') -cne '1.2.3.0' -or
        $AppCertIdentity.GetAttribute('ProcessorArchitecture') -cne 'x64' -or
        -not $AppCertApplication -or
        $AppCertApplication.GetAttribute('Id') -cne 'CalorieSteward' -or
        $AppCertApplication.GetAttribute('Executable') -cne 'Calorie Steward by LAI ZEYU.exe') {
      throw "Candidate AppCert manifest differs from the reviewed AppX identity."
    }
  } elseif (-not $AllowAlreadyRemoved) {
    throw "Candidate AppCert install root disappeared before ownership could be proved."
  }
  [void]$CreatedAppCertRoots.Add($AppCertRoot)
  return $InstallLocation
}

function Assert-WackReportCandidateBinding {
  param([Parameter(Mandatory = $true)][string]$ReportPath)
  [xml]$WackXml = Get-Content -LiteralPath $ReportPath -Raw
  $Programs = @(
    $WackXml.SelectNodes("//*[local-name()='Installed_Programs']/*[local-name()='Program']") |
      Where-Object { $_.GetAttribute('Source') -ceq 'AppxPackage' }
  )
  if ($Programs.Count -ne 1) {
    throw "WACK report must identify exactly one tested AppxPackage candidate."
  }
  if ($Programs[0].GetAttribute('Name') -cne $IdentityName -or
      $Programs[0].GetAttribute('Publisher') -cne $Publisher) {
    throw "WACK report AppxPackage program differs from the reserved candidate identity."
  }
  $PackageManifests = @($Programs[0].SelectNodes(".//*[local-name()='PackageManifest']"))
  $Identities = @($Programs[0].SelectNodes(".//*[local-name()='PackageManifest']//*[local-name()='Identity']"))
  $Applications = @($Programs[0].SelectNodes(".//*[local-name()='PackageManifest']//*[local-name()='Application']"))
  $PublisherDisplayNames = @($Programs[0].SelectNodes(".//*[local-name()='PackageManifest']//*[local-name()='Properties']/*[local-name()='PublisherDisplayName']"))
  if ($PackageManifests.Count -ne 1 -or $Identities.Count -ne 1 -or
      $Applications.Count -ne 1 -or $PublisherDisplayNames.Count -ne 1) {
    throw "WACK report candidate manifest tree is missing or ambiguous."
  }
  $PackageFullName = $PackageManifests[0].GetAttribute('PackageFullName')
  $RawInstallLocation = $Programs[0].GetAttribute('RootDirPath')
  if ($Identities[0].GetAttribute('Name') -cne $IdentityName -or
      $Identities[0].GetAttribute('Publisher') -cne $Publisher -or
      $Identities[0].GetAttribute('Version') -cne '1.2.3.0' -or
      $Identities[0].GetAttribute('ProcessorArchitecture') -cne 'x64' -or
      $Applications[0].GetAttribute('Id') -cne 'CalorieSteward' -or
      $Applications[0].GetAttribute('Executable') -cne 'Calorie Steward by LAI ZEYU.exe' -or
      $PublisherDisplayNames[0].InnerText -cne 'LAI ZEYU' -or
      [string]::IsNullOrWhiteSpace($PackageFullName) -or
      [string]::IsNullOrWhiteSpace($RawInstallLocation)) {
    throw "WACK report candidate identity differs from the exact signed AppX."
  }
  $InstallLocation = Register-ExactAppCertInstallLocation `
    -PackageFullName $PackageFullName `
    -RawInstallLocation $RawInstallLocation `
    -AllowAlreadyRemoved
  return [pscustomobject]@{
    PackageFullName = $PackageFullName
    InstallLocation = $InstallLocation
  }
}

function Capture-FreshExactAppCertRoots {
  param([Parameter(Mandatory = $true)][Collections.Generic.List[string]]$Errors)
  foreach ($RootItem in @(
    Get-ChildItem -LiteralPath $WindowsTempRoot -Directory -Force -Filter 'appcert_*' -ErrorAction SilentlyContinue
  )) {
    $ExactRoot = [IO.Path]::GetFullPath($RootItem.FullName).TrimEnd('\')
    if ($PreexistingAppCertRoots.Contains($ExactRoot) -or $CreatedAppCertRoots.Contains($ExactRoot)) { continue }
    try {
      if ([DateTimeOffset]$RootItem.CreationTimeUtc -lt $StoreRunStartedUtc.AddSeconds(-2) -or
          [DateTimeOffset]$RootItem.LastWriteTimeUtc -lt $StoreRunStartedUtc.AddSeconds(-2) -or
          (Test-TreeHasReparsePoint -Root $ExactRoot)) {
        throw "New AppCert root is stale or contains a reparse point."
      }
      $InstallDirectories = @(Get-ChildItem -LiteralPath $ExactRoot -Directory -Force)
      $CandidateDirectories = @()
      foreach ($InstallDirectory in $InstallDirectories) {
        $ManifestPath = Join-Path $InstallDirectory.FullName 'AppxManifest.xml'
        if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { continue }
        [xml]$CandidateManifest = Get-Content -LiteralPath $ManifestPath -Raw
        $CandidateIdentity = $CandidateManifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
        $CandidateApplication = $CandidateManifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
        if ($CandidateIdentity -and $CandidateApplication -and
            $CandidateIdentity.GetAttribute('Name') -ceq $IdentityName -and
            $CandidateIdentity.GetAttribute('Publisher') -ceq $Publisher -and
            $CandidateIdentity.GetAttribute('Version') -ceq '1.2.3.0' -and
            $CandidateIdentity.GetAttribute('ProcessorArchitecture') -ceq 'x64' -and
            $CandidateApplication.GetAttribute('Id') -ceq 'CalorieSteward' -and
            $CandidateApplication.GetAttribute('Executable') -ceq 'Calorie Steward by LAI ZEYU.exe') {
          $CandidateDirectories += $InstallDirectory
        }
      }
      if ($InstallDirectories.Count -ne 1 -or $CandidateDirectories.Count -ne 1) {
        throw "New AppCert root is not exclusively bound to one exact candidate manifest."
      }
      [void](Register-ExactAppCertInstallLocation `
        -PackageFullName $CandidateDirectories[0].Name `
        -RawInstallLocation $CandidateDirectories[0].FullName)
    } catch {
      $Errors.Add("Refused to claim new AppCert root '$ExactRoot': $($_.Exception.Message)")
    }
  }
}

function Assert-WackXmlPass {
  param([Parameter(Mandatory = $true)][string]$ReportPath)
  $ReportItem = Get-Item -LiteralPath $ReportPath
  if ($ReportItem.Length -lt 512) { throw "WACK report is too small to prove a complete run." }
  [xml]$Report = Get-Content -LiteralPath $ReportPath -Raw
  $Root = $Report.DocumentElement
  if (-not $Root -or $Root.LocalName -cne 'REPORT') {
    throw "WACK XML must contain exactly one official REPORT document root."
  }
  $Overall = $Root.GetAttribute('OVERALL_RESULT').Trim().ToUpperInvariant()
  if ($Overall -notin @('PASS', 'PASSED')) {
    throw "WACK REPORT root does not declare an overall PASS."
  }
  $PartialRun = $Root.GetAttribute('PARTIAL_RUN').Trim().ToUpperInvariant()
  if ($PartialRun -notin @('FALSE', '0')) {
    throw "WACK REPORT root is missing an explicit non-partial result."
  }
  $LatestVersion = $Root.GetAttribute('LATEST_VERSION').Trim().ToUpperInvariant()
  if ($LatestVersion -notin @('TRUE', '1')) {
    throw "WACK REPORT root does not prove that the latest installed kit was used."
  }
  $WackVersion = $Root.GetAttribute('VERSION').Trim()
  if ($WackVersion -notmatch '^\d+(?:\.\d+){2,3}$') {
    throw "WACK REPORT root contains no valid kit version."
  }
  $TestNodes = @($Report.SelectNodes(
    "//*[translate(local-name(), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')='TEST']"
  ))
  if ($TestNodes.Count -eq 0) { throw "WACK report contains no test records." }
  $SeenTestIndexes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $SeenTestNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $ResultValues = @()
  foreach ($Test in $TestNodes) {
    $TestIndex = $Test.GetAttribute('INDEX').Trim()
    $TestName = $Test.GetAttribute('NAME').Trim()
    if ($TestIndex -notmatch '^\d+$' -or -not $TestName -or
        -not $SeenTestIndexes.Add($TestIndex) -or -not $SeenTestNames.Add($TestName)) {
      throw "WACK report contains a missing or duplicate test identity."
    }
    $DirectResults = @($Test.SelectNodes(
      "./*[translate(local-name(), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')='RESULT']"
    ))
    if ($DirectResults.Count -ne 1) {
      throw "Each WACK TEST must contain exactly one direct RESULT: $TestIndex|$TestName"
    }
    $ResultValues += (($DirectResults[0].InnerText.Trim().ToUpperInvariant() -replace '[_\-/]+', ' ') -replace '\s+', ' ')
  }
  $AllowedResults = @('PASS', 'PASSED', 'N A', 'NA', 'NOT APPLICABLE')
  $UnexpectedResults = @($ResultValues | Where-Object {
    [string]::IsNullOrWhiteSpace($_) -or $_ -notin $AllowedResults
  })
  if ($UnexpectedResults.Count -gt 0) {
    $ShownResult = $(if ([string]::IsNullOrWhiteSpace($UnexpectedResults[0])) { '<EMPTY>' } else { $UnexpectedResults[0] })
    throw "WACK contains a non-whitelisted test result: $ShownResult"
  }
  return [pscustomobject]@{
    Overall = $Overall
    LatestVersion = $true
    Version = $WackVersion
    TestResultCount = $ResultValues.Count
  }
}

$WorkRoot = Join-Path $env:RUNNER_TEMP "calorie-store-$([Guid]::NewGuid().ToString('N'))"
$UnpackedRoot = Join-Path $WorkRoot 'unpacked'
$InstalledPackage = $null
$PackageMutationAttempted = $false
$CreatedPackageFullNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$CreatedProcessIds = [Collections.Generic.HashSet[int]]::new()
$CreatedFamilyRoots = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$CreatedAppCertRoots = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$PrimaryError = $null

try {
  New-Item -ItemType Directory -Path $UnpackedRoot | Out-Null
  & $MakeAppx.FullName unpack /p $OriginalAppx /d $UnpackedRoot | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "AppX unpack failed with exit code $LASTEXITCODE." }
  [xml]$Manifest = Get-Content -LiteralPath (Join-Path $UnpackedRoot 'AppxManifest.xml') -Raw
  $Namespaces = [Xml.XmlNamespaceManager]::new($Manifest.NameTable)
  $Namespaces.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $Namespaces.AddNamespace('r', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
  $Identity = $Manifest.SelectSingleNode('/f:Package/f:Identity', $Namespaces)
  $Properties = $Manifest.SelectSingleNode('/f:Package/f:Properties', $Namespaces)
  $Application = $Manifest.SelectSingleNode('/f:Package/f:Applications/f:Application', $Namespaces)
  if (-not $Identity -or $Identity.Name -cne $IdentityName -or $Identity.Publisher -cne $Publisher) {
    throw "AppX identity does not exactly match Partner Center."
  }
  if ($Identity.ProcessorArchitecture -cne 'x64' -or $Identity.Version -cne '1.2.3.0') {
    throw "Store package architecture or version is not the reviewed x64 1.2.3.0 candidate."
  }
  if ($Properties.DisplayName -cne 'Calorie Steward by LAI ZEYU' -or
      $Properties.PublisherDisplayName -cne 'LAI ZEYU') {
    throw "Visible Store product/publisher identity is not exact."
  }
  if (-not $Application -or $Application.Id -cne 'CalorieSteward' -or
      $Application.Executable -cne 'Calorie Steward by LAI ZEYU.exe') {
    throw "Store Application Id or executable is not exact."
  }
  if (-not $Manifest.SelectSingleNode("/f:Package/f:Capabilities/r:Capability[@Name='runFullTrust']", $Namespaces)) {
    throw "runFullTrust capability is missing."
  }
  $Languages = @($Manifest.SelectNodes('/f:Package/f:Resources/f:Resource', $Namespaces) | ForEach-Object { $_.Language })
  if ('en-US' -notin $Languages -or 'zh-CN' -notin $Languages) { throw "Declared languages are incomplete." }
  foreach ($Locale in @('en-US.pak', 'zh-CN.pak')) {
    if (-not (Test-Path -LiteralPath (Join-Path $UnpackedRoot "locales\$Locale") -PathType Leaf)) {
      throw "Store package Electron locale is missing: $Locale"
    }
  }
  foreach ($LegalFile in @('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md')) {
    if (-not (Test-Path -LiteralPath (Join-Path $UnpackedRoot "resources\legal\$LegalFile") -PathType Leaf)) {
      throw "Store package legal file is missing: $LegalFile"
    }
  }
  $StoreExe = Join-Path $UnpackedRoot ([string]$Application.Executable)
  if (-not (Test-Path -LiteralPath $StoreExe -PathType Leaf)) { throw "Store package main executable is missing." }
  $VersionInfo = (Get-Item -LiteralPath $StoreExe).VersionInfo
  if ($VersionInfo.ProductName -cne 'Calorie Steward by LAI ZEYU' -or
      $VersionInfo.LegalCopyright -notmatch 'LAI ZEYU.*来泽宇') {
    throw "Compiled executable product/author metadata is not exact."
  }
  $FuseText = (& node windows-app/node_modules/@electron/fuses/dist/bin.js read --app $StoreExe 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Store package Electron fuse inspection failed." }
  foreach ($ExpectedFuse in @(
    'RunAsNode is Disabled',
    'EnableCookieEncryption is Enabled',
    'EnableNodeOptionsEnvironmentVariable is Disabled',
    'EnableNodeCliInspectArguments is Disabled',
    'EnableEmbeddedAsarIntegrityValidation is Enabled',
    'OnlyLoadAppFromAsar is Enabled',
    'LoadBrowserProcessSpecificV8Snapshot is Disabled',
    'GrantFileProtocolExtraPrivileges is Disabled',
    'WasmTrapHandlers is Enabled'
  )) {
    if (-not $FuseText.Contains($ExpectedFuse)) { throw "Store package Electron fuse mismatch: $ExpectedFuse" }
  }
  $StoreExeHash = (Get-FileHash -LiteralPath $StoreExe -Algorithm SHA256).Hash.ToLowerInvariant()

  Assert-FrozenSigningCandidate

  $WackReport = Join-Path $EvidenceRoot 'wack-report.xml'
  $ResetLog = Join-Path $EvidenceRoot 'wack-reset.txt'
  $TestLog = Join-Path $EvidenceRoot 'wack-test.txt'
  foreach ($StalePath in @($WackReport, $ResetLog, $TestLog)) {
    if (Test-Path -LiteralPath $StalePath) { throw "Stale WACK evidence survived clean-directory preflight." }
  }
  $WackStartedUtc = [DateTime]::UtcNow
  $ResetExitCode = Invoke-BoundedNativeProcess `
    -FilePath $AppCert `
    -Arguments @('reset') `
    -TimeoutSeconds 300 `
    -Label 'appcert.exe reset' `
    -LogPath $ResetLog
  if ($ResetExitCode -ne 0) { throw "appcert.exe reset failed with exit code $ResetExitCode." }
  $PackageMutationAttempted = $true
  $WackExitCode = Invoke-BoundedNativeProcess `
    -FilePath $AppCert `
    -Arguments @('test', '-appxpackagepath', $SignedCopy, '-reportoutputpath', $WackReport) `
    -TimeoutSeconds 5400 `
    -Label 'appcert.exe test' `
    -LogPath $TestLog
  if ($WackExitCode -ne 0) { throw "appcert.exe test failed with exit code $WackExitCode." }
  if (-not (Test-Path -LiteralPath $WackReport -PathType Leaf) -or
      (Get-Item -LiteralPath $WackReport).LastWriteTimeUtc -lt $WackStartedUtc.AddSeconds(-2)) {
    throw "WACK report is missing or stale."
  }
  $WackResult = Assert-WackXmlPass -ReportPath $WackReport
  $WackCandidateBinding = Assert-WackReportCandidateBinding -ReportPath $WackReport
  Assert-FrozenSigningCandidate
  $OriginalHashAfterWack = (Get-FileHash -LiteralPath $OriginalAppx -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($OriginalHashAfterWack -cne $OriginalHashBefore) { throw "WACK phase changed the original Partner Center AppX." }

  $WackResiduePackages = @(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue)
  foreach ($Package in $WackResiduePackages) { [void]$CreatedPackageFullNames.Add([string]$Package.PackageFullName) }
  $WackResidueProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -ieq 'Calorie Steward by LAI ZEYU.exe' -and $_.ExecutablePath -and
      (Test-IdentityOwnedExecutable -ExecutablePath $_.ExecutablePath)
    }
  )
  foreach ($Process in $WackResidueProcesses) { [void]$CreatedProcessIds.Add([int]$Process.ProcessId) }
  $WackFamilyRoots = @(
    Get-ChildItem -LiteralPath $PackagesRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.StartsWith($FamilyPrefix, [StringComparison]::OrdinalIgnoreCase)
    }
  )
  foreach ($Root in $WackFamilyRoots) { [void]$CreatedFamilyRoots.Add($Root.FullName) }
  if ($WackResiduePackages.Count -gt 0 -or $WackResidueProcesses.Count -gt 0 -or $WackFamilyRoots.Count -gt 0) {
    throw "WACK left candidate packages, processes, or PFN data; exact cleanup will run but this certification gate fails."
  }

  Add-AppxPackage -Path $SignedCopy
  $InstalledPackage = Get-AppxPackage -Name $IdentityName | Select-Object -First 1
  if (-not $InstalledPackage -or $InstalledPackage.Publisher -cne $Publisher) {
    throw "Sideloaded Store package identity is invalid."
  }
  [void]$CreatedPackageFullNames.Add([string]$InstalledPackage.PackageFullName)
  $PackageDataPath = Join-Path $PackagesRoot $InstalledPackage.PackageFamilyName
  [void]$CreatedFamilyRoots.Add($PackageDataPath)
  if (Test-Path -LiteralPath $PackageDataPath -PathType Container) {
    $PrelaunchData = @(Get-ChildItem -LiteralPath $PackageDataPath -Force -ErrorAction SilentlyContinue)
    if ($PrelaunchData.Count -gt 0) {
      throw "Package data existed before first launch; refusing to consume or later delete it."
    }
  }
  $InstalledExe = Join-Path $InstalledPackage.InstallLocation ([string]$Application.Executable)
  if (-not (Test-Path -LiteralPath $InstalledExe -PathType Leaf) -or
      (Get-FileHash -LiteralPath $InstalledExe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $StoreExeHash) {
    throw "Installed executable does not match the inspected AppX bytes."
  }

  $LaunchStartedUtc = [DateTime]::UtcNow
  Start-Process explorer.exe "shell:AppsFolder\$($InstalledPackage.PackageFamilyName)!CalorieSteward"
  $Deadline = [DateTime]::UtcNow.AddSeconds(90)
  $ReadyFiles = @()
  do {
    $ReadyFiles = @(Get-ChildItem -LiteralPath $PackageDataPath -Recurse -File -Filter ui_ready.json -ErrorAction SilentlyContinue)
    if ($ReadyFiles.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $Deadline)
  if ($ReadyFiles.Count -ne 1) { throw "Packaged UI readiness marker is missing or ambiguous." }
  if ($ReadyFiles[0].LastWriteTimeUtc -lt $LaunchStartedUtc.AddSeconds(-2)) { throw "Packaged UI marker is stale." }
  $Ready = Get-Content -LiteralPath $ReadyFiles[0].FullName -Raw | ConvertFrom-Json
  $MarkerCreatedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$Ready.createdAtUtc, [ref]$MarkerCreatedAt) -or
      $MarkerCreatedAt.UtcDateTime -lt $LaunchStartedUtc.AddSeconds(-2)) {
    throw "Packaged UI marker timestamp is missing or stale."
  }
  if ($Ready.schemaVersion -ne 2 -or
      $Ready.product -cne 'Calorie Steward by LAI ZEYU' -or
      $Ready.author -cne 'LAI ZEYU（来泽宇）' -or
      $Ready.version -cne '1.2.3' -or
      $Ready.executableSha256 -cne $StoreExeHash -or
      [IO.Path]::GetFullPath([string]$Ready.executablePath) -ine [IO.Path]::GetFullPath($InstalledExe) -or
      [int]$Ready.processId -le 0 -or
      $Ready.origin -cne 'http://127.0.0.1:47823' -or
      $null -ne $Ready.qaNonce -or
      $Ready.reactRootReady -ne $true -or
      $Ready.privacyEntryReady -ne $true) {
    throw "Packaged Store UI evidence does not match product, author, process, and exact installed executable."
  }
  $MarkerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Ready.processId)" -ErrorAction SilentlyContinue
  if (-not $MarkerProcess -or -not $MarkerProcess.ExecutablePath -or
      [IO.Path]::GetFullPath($MarkerProcess.ExecutablePath) -ine [IO.Path]::GetFullPath($InstalledExe)) {
    throw "UI marker PID does not belong to the exact manifest executable."
  }
  [void]$CreatedProcessIds.Add([int]$Ready.processId)
  $Listener = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 47823 -State Listen -ErrorAction SilentlyContinue)
  if ($Listener.Count -ne 1 -or [int]$Listener[0].OwningProcess -ne [int]$Ready.processId) {
    throw "Loopback listener is not owned by the process-bound manifest executable."
  }
  $Health = Invoke-WebRequest http://127.0.0.1:47823/ -UseBasicParsing -TimeoutSec 15
  if ($Health.StatusCode -ne 200) { throw "Sideloaded Store app local origin failed." }
  $InstalledProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ExecutablePath -and (Test-PathWithinRoot -Path $_.ExecutablePath -Root $InstalledPackage.InstallLocation)
    }
  )
  if ($InstalledProcesses.Count -eq 0) { throw "No running process belongs to the installed Store package." }
  foreach ($Process in $InstalledProcesses) {
    [void]$CreatedProcessIds.Add([int]$Process.ProcessId)
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $ProcessDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $RemainingOwnedProcesses = @($CreatedProcessIds | ForEach-Object {
      $CurrentProcessId = $_
      $CurrentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $CurrentProcessId" -ErrorAction SilentlyContinue
      if ($CurrentProcess -and $CurrentProcess.ExecutablePath -and
          (Test-IdentityOwnedExecutable -ExecutablePath $CurrentProcess.ExecutablePath)) {
        $CurrentProcess
      }
    })
    if ($RemainingOwnedProcesses.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $ProcessDeadline)
  if ($RemainingOwnedProcesses.Count -gt 0) { throw "Store process tree survived bounded termination." }

  Remove-AppxPackage -Package $InstalledPackage.PackageFullName
  $RemovalDeadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    $StillInstalled = @(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Where-Object {
      $_.PackageFullName -ceq $InstalledPackage.PackageFullName
    })
    if ($StillInstalled.Count -eq 0 -and -not (Test-Path -LiteralPath $PackageDataPath)) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $RemovalDeadline)
  if ($StillInstalled.Count -gt 0 -or (Test-Path -LiteralPath $PackageDataPath)) {
    throw "Exact Store package or package-local data remained after removal."
  }
  $OriginalHashAfter = (Get-FileHash -LiteralPath $OriginalAppx -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($OriginalHashAfter -cne $OriginalHashBefore) { throw "Original Partner Center candidate changed during QA." }
  Assert-FrozenSigningCandidate

  [ordered]@{
    round = $Round
    product = 'Calorie Steward by LAI ZEYU'
    author = 'LAI ZEYU（来泽宇）'
    publisherDisplayName = 'LAI ZEYU'
    identityName = $IdentityName
    publisher = $Publisher
    sourceCommit = $SourceCommit
    appxSha256 = $OriginalHashAfter
    signedAppxSha256 = $ExpectedSignedHash
    temporaryCertificateThumbprint = $CertificateThumbprint
    signToolSha256 = $SignToolHash
    signToolFileVersion = $SignToolVersion
    makeAppxSha256 = $MakeAppxHash
    makeAppxFileVersion = $MakeAppxVersion
    appCertSha256 = $AppCertHash
    appCertFileVersion = $AppCertVersion
    executableSha256 = $StoreExeHash
    wackOverall = $WackResult.Overall
    wackLatestVersion = $WackResult.LatestVersion
    wackVersion = $WackResult.Version
    wackTestResultCount = $WackResult.TestResultCount
    wackPackageFullName = $WackCandidateBinding.PackageFullName
    wackReportSha256 = (Get-FileHash -LiteralPath $WackReport -Algorithm SHA256).Hash.ToLowerInvariant()
    wackResetLogSha256 = (Get-FileHash -LiteralPath $ResetLog -Algorithm SHA256).Hash.ToLowerInvariant()
    wackTestLogSha256 = (Get-FileHash -LiteralPath $TestLog -Algorithm SHA256).Hash.ToLowerInvariant()
    processBoundUi = 'PASS'
    uninstall = 'PASS'
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'store-lifecycle.json') -Encoding UTF8
  "$OriginalHashAfter  $([IO.Path]::GetFileName($OriginalAppx))" |
    Set-Content -LiteralPath (Join-Path $EvidenceRoot 'STORE_SHA256SUMS.txt') -Encoding UTF8
  Write-Host "Exact Partner Center AppX passed WACK, process-bound UI, author, install, and uninstall gates."
} catch {
  $PrimaryError = $_
} finally {
  $CleanupErrors = [Collections.Generic.List[string]]::new()
  try {
    Assert-FrozenSigningCandidate
  } catch {
    $CleanupErrors.Add("Frozen Store QA signing candidate failed its final integrity check: $($_.Exception.Message)")
  }
  try {
    Capture-FreshExactAppCertRoots -Errors $CleanupErrors
  } catch {
    $CleanupErrors.Add("Could not inventory fresh AppCert roots: $($_.Exception.Message)")
  }
  try {
    $CurrentIdentityPackages = @(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue)
    if ($PackageMutationAttempted) {
      foreach ($Package in $CurrentIdentityPackages) {
        if ($Package.Publisher -ceq $Publisher -and
            ([string]$Package.Version) -ceq '1.2.3.0' -and
            ([string]$Package.Architecture) -ieq 'X64') {
          [void]$CreatedPackageFullNames.Add([string]$Package.PackageFullName)
        } else {
          $CleanupErrors.Add("Refused to claim a post-mutation package with mismatched publisher, version, or architecture: $($Package.PackageFullName)")
        }
      }
    }
    foreach ($Package in $CurrentIdentityPackages) {
      if ($CreatedPackageFullNames.Contains([string]$Package.PackageFullName)) {
        foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
          $_.ExecutablePath -and (Test-PathWithinRoot -Path $_.ExecutablePath -Root $Package.InstallLocation)
        })) {
          [void]$CreatedProcessIds.Add([int]$Process.ProcessId)
        }
      }
    }
    foreach ($Process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -ieq 'Calorie Steward by LAI ZEYU.exe' -and $_.ExecutablePath -and
      (Test-IdentityOwnedExecutable -ExecutablePath $_.ExecutablePath)
    })) {
      [void]$CreatedProcessIds.Add([int]$Process.ProcessId)
    }
    foreach ($ProcessId in $CreatedProcessIds) {
      $OwnedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
      if ($OwnedProcess -and $OwnedProcess.ExecutablePath -and
          (Test-IdentityOwnedExecutable -ExecutablePath $OwnedProcess.ExecutablePath)) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  $FinalProcessDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $RemainingCreatedProcesses = @($CreatedProcessIds | ForEach-Object {
      $CurrentProcessId = $_
      $CurrentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $CurrentProcessId" -ErrorAction SilentlyContinue
      if ($CurrentProcess -and $CurrentProcess.ExecutablePath -and
          (Test-IdentityOwnedExecutable -ExecutablePath $CurrentProcess.ExecutablePath)) {
        $CurrentProcess
      }
    })
    if ($RemainingCreatedProcesses.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $FinalProcessDeadline)
  if ($RemainingCreatedProcesses.Count -gt 0) {
    $CleanupErrors.Add('Owned Store process survived cleanup termination.')
  }
  foreach ($PackageFullName in $CreatedPackageFullNames) {
    $ExactPackage = @(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Where-Object {
      $_.PackageFullName -ceq $PackageFullName
    })
    if ($ExactPackage.Count -eq 1) {
      try {
        Remove-AppxPackage -Package $PackageFullName -ErrorAction Stop
      } catch {
        $CleanupErrors.Add("Could not remove owned Store package '$PackageFullName': $($_.Exception.Message)")
      }
    }
  }
  $FinalPackageDeadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    $RemainingCreatedPackages = @(
      Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Where-Object {
        $CreatedPackageFullNames.Contains([string]$_.PackageFullName)
      }
    )
    if ($RemainingCreatedPackages.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $FinalPackageDeadline)
  if ($RemainingCreatedPackages.Count -gt 0) {
    $CleanupErrors.Add('Owned Store package survived cleanup removal.')
  }
  foreach ($Root in @(
    Get-ChildItem -LiteralPath $PackagesRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.StartsWith($FamilyPrefix, [StringComparison]::OrdinalIgnoreCase)
    }
  )) {
    [void]$CreatedFamilyRoots.Add($Root.FullName)
  }
    foreach ($FamilyRoot in $CreatedFamilyRoots) {
      if (-not (Test-Path -LiteralPath $FamilyRoot)) { continue }
      try {
        $ExactRoot = [IO.Path]::GetFullPath($FamilyRoot)
        $PackagesPrefix = [IO.Path]::GetFullPath($PackagesRoot).TrimEnd('\') + '\'
        $Leaf = [IO.Path]::GetFileName($ExactRoot)
        if (-not $ExactRoot.StartsWith($PackagesPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not $Leaf.StartsWith($FamilyPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            ((Get-Item -LiteralPath $ExactRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          $CleanupErrors.Add("Refused to clean PFN data root outside the exact candidate identity: $FamilyRoot")
          continue
        }
        if (@(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue).Count -gt 0) {
          $CleanupErrors.Add("Refused PFN data cleanup while candidate identity remained installed: $ExactRoot")
          continue
        }
        Remove-Item -LiteralPath $ExactRoot -Recurse -Force
      } catch {
        $CleanupErrors.Add("Could not validate or remove PFN data root '$FamilyRoot': $($_.Exception.Message)")
      }
    }
  } catch {
    $CleanupErrors.Add("Unexpected Store package/process cleanup error: $($_.Exception.Message)")
  }
  foreach ($AppCertRoot in $CreatedAppCertRoots) {
    try {
      $ExactRoot = [IO.Path]::GetFullPath($AppCertRoot).TrimEnd('\')
      $Parent = [IO.Directory]::GetParent($ExactRoot).FullName.TrimEnd('\')
      $Leaf = [IO.Path]::GetFileName($ExactRoot)
      if (-not [string]::Equals($Parent, $WindowsTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
          $Leaf -cnotmatch '^appcert_[A-Za-z0-9._-]+$' -or
          $PreexistingAppCertRoots.Contains($ExactRoot)) {
        throw "AppCert cleanup root escaped its exact new Windows Temp boundary."
      }
      if (Test-Path -LiteralPath $ExactRoot) {
        if (Test-TreeHasReparsePoint -Root $ExactRoot) {
          throw "AppCert cleanup tree contains a reparse point."
        }
        Remove-Item -LiteralPath $ExactRoot -Recurse -Force -ErrorAction Stop
      }
      if (Test-Path -LiteralPath $ExactRoot) {
        throw "Exact AppCert root remained after cleanup."
      }
    } catch {
      $CleanupErrors.Add("Could not remove owned AppCert root '$AppCertRoot': $($_.Exception.Message)")
    }
  }
  try {
    Capture-FreshExactAppCertRoots -Errors $CleanupErrors
    if (@(Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue).Count -gt 0 -or
        @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
          $_.Name -ieq 'Calorie Steward by LAI ZEYU.exe'
        }).Count -gt 0 -or
        @(Get-NetTCPConnection -LocalPort 47823 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
      $CleanupErrors.Add('Store lifecycle cleanup left package, process, or listener residue.')
    }
    $RemainingOwnedAppCertRoots = @($CreatedAppCertRoots | Where-Object { Test-Path -LiteralPath $_ })
    if ($RemainingOwnedAppCertRoots.Count -gt 0) {
      $CleanupErrors.Add('Store lifecycle cleanup left an exact candidate AppCert root.')
    }
  } catch {
    $CleanupErrors.Add("Could not complete the final Store residue check: $($_.Exception.Message)")
  }
  if (Test-Path -LiteralPath $WorkRoot) {
    try {
      Remove-Item -LiteralPath $WorkRoot -Recurse -Force
    } catch {
      $CleanupErrors.Add("Could not remove Store lifecycle work directory: $($_.Exception.Message)")
    }
  }
  if (Test-Path -LiteralPath $WorkRoot) {
    $CleanupErrors.Add('Store lifecycle work directory remained after cleanup.')
  }
  if ($CleanupErrors.Count -gt 0) {
    $PrimaryContext = $(if ($PrimaryError) {
      "Primary Store lifecycle failure: $($PrimaryError.Exception.Message). "
    } else { '' })
    throw "$($PrimaryContext)Store lifecycle cleanup failed: $($CleanupErrors -join '; ')"
  }
}
if ($PrimaryError) { throw $PrimaryError }
