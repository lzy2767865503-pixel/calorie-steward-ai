param(
  [Parameter(Mandatory = $true)]
  [string]$AppxPath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedExecutableSha256,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2)]
  [int]$Round
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

if (-not $IsWindows) { throw 'Store submission inspection must run on Windows.' }
if ($ExpectedExecutableSha256 -cnotmatch '^[0-9a-f]{64}$') {
  throw 'ExpectedExecutableSha256 must be one lowercase SHA-256 digest.'
}

. (Join-Path $PSScriptRoot 'trusted-windows-sdk-tool.ps1')

$ExpectedIdentity = 'LAIZEYU.CalorieStewardbyLAIZEYU'
$ExpectedPublisher = 'CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8'
$ExpectedExecutable = 'app\Calorie Steward by LAI ZEYU.exe'
$ExpectedVersion = '1.2.3.0'
$ExpectedAssets = [ordered]@{
  'StoreLogo.png' = @(50, 50)
  'Square44x44Logo.png' = @(44, 44)
  'Square150x150Logo.png' = @(150, 150)
  'Wide310x150Logo.png' = @(310, 150)
}

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $ProjectRoot
$Appx = (Resolve-Path -LiteralPath $AppxPath).Path
if ([IO.Path]::GetExtension($Appx) -cne '.appx' -or
    (Split-Path -Leaf $Appx) -cne 'Calorie-Steward-Windows-1.2.3-x64.appx') {
  throw 'Store submission candidate must be the exact expected 1.2.3 x64 AppX artifact.'
}
if ((Get-AuthenticodeSignature -LiteralPath $Appx).Status -ne
    [Management.Automation.SignatureStatus]::NotSigned) {
  throw 'Partner Center source AppX must be unsigned; Microsoft signs it after certification.'
}
if (Test-Path -LiteralPath $EvidenceDirectory) {
  throw "Evidence directory already exists; refusing stale evidence: $EvidenceDirectory"
}
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
$EvidenceRoot = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$RunnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$WorkRoot = Join-Path $RunnerTemp "calorie-store-inspect-$Round-$([Guid]::NewGuid().ToString('N'))"
$UnpackedRoot = Join-Path $WorkRoot 'unpacked'
$MakeAppx = Get-TrustedWindowsSdkTool -Name 'makeappx.exe'
$AppxHashBefore = (Get-FileHash -LiteralPath $Appx -Algorithm SHA256).Hash.ToLowerInvariant()
$SourceCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $SourceCommit -cnotmatch '^[a-f0-9]{40}$') {
  throw 'Source commit could not be resolved.'
}

function Assert-NoReparsePoint {
  param([Parameter(Mandatory = $true)][string]$Root)
  $Items = @((Get-Item -LiteralPath $Root -Force)) +
    @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
  $Reparse = @($Items | Where-Object {
    ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
  })
  if ($Reparse.Count -gt 0) {
    throw "Unpacked Store candidate contains a reparse point: $($Reparse[0].FullName)"
  }
}

function Get-PngDimensions {
  param([Parameter(Mandatory = $true)][string]$Path)
  $Bytes = [IO.File]::ReadAllBytes($Path)
  if ($Bytes.Length -lt 24 -or
      [BitConverter]::ToString($Bytes[0..7]) -cne '89-50-4E-47-0D-0A-1A-0A') {
    throw "Store asset is not a valid PNG header: $Path"
  }
  return @(
    [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($Bytes, 16)),
    [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($Bytes, 20))
  )
}

function Get-RequiredSingleNode {
  param(
    [Parameter(Mandatory = $true)][xml]$Document,
    [Parameter(Mandatory = $true)][string]$XPath,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $Nodes = @($Document.SelectNodes($XPath))
  if ($Nodes.Count -ne 1) { throw "AppX manifest must contain exactly one $Label." }
  return $Nodes[0]
}

$PrimaryError = $null
try {
  New-Item -ItemType Directory -Path $UnpackedRoot | Out-Null
  & $MakeAppx.FullName unpack /p $Appx /d $UnpackedRoot /o | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "makeappx unpack failed with exit code $LASTEXITCODE." }
  Assert-NoReparsePoint -Root $UnpackedRoot

  if (Test-Path -LiteralPath (Join-Path $UnpackedRoot 'AppxSignature.p7x')) {
    throw 'Unsigned Partner Center source unexpectedly contains AppxSignature.p7x.'
  }
  $ForbiddenKeyMaterial = @(Get-ChildItem -LiteralPath $UnpackedRoot -Recurse -File -Force | Where-Object {
    $_.Extension -in @('.pfx', '.p12', '.key', '.pem', '.cer', '.crt')
  })
  if ($ForbiddenKeyMaterial.Count -gt 0) {
    throw "Store candidate contains certificate or key material: $($ForbiddenKeyMaterial[0].FullName)"
  }

  $ManifestPath = Join-Path $UnpackedRoot 'AppxManifest.xml'
  [xml]$Manifest = Get-Content -LiteralPath $ManifestPath -Raw
  $Identity = Get-RequiredSingleNode -Document $Manifest `
    -XPath "/*[local-name()='Package']/*[local-name()='Identity']" -Label 'Identity'
  $Properties = Get-RequiredSingleNode -Document $Manifest `
    -XPath "/*[local-name()='Package']/*[local-name()='Properties']" -Label 'Properties'
  $Application = Get-RequiredSingleNode -Document $Manifest `
    -XPath "/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']" `
    -Label 'Application'
  if ($Identity.GetAttribute('Name') -cne $ExpectedIdentity -or
      $Identity.GetAttribute('Publisher') -cne $ExpectedPublisher -or
      $Identity.GetAttribute('ProcessorArchitecture') -cne 'x64' -or
      $Identity.GetAttribute('Version') -cne $ExpectedVersion) {
    throw 'AppX identity, publisher, architecture, or version differs from Partner Center.'
  }
  $DisplayName = Get-RequiredSingleNode -Document $Manifest `
    -XPath "/*[local-name()='Package']/*[local-name()='Properties']/*[local-name()='DisplayName']" `
    -Label 'Properties/DisplayName'
  $PublisherDisplayName = Get-RequiredSingleNode -Document $Manifest `
    -XPath "/*[local-name()='Package']/*[local-name()='Properties']/*[local-name()='PublisherDisplayName']" `
    -Label 'Properties/PublisherDisplayName'
  if ($DisplayName.InnerText -cne 'Calorie Steward by LAI ZEYU' -or
      $PublisherDisplayName.InnerText -cne 'LAI ZEYU') {
    throw 'Visible Store product or publisher identity is not exact.'
  }
  if ($Application.GetAttribute('Id') -cne 'CalorieSteward' -or
      $Application.GetAttribute('Executable') -cne $ExpectedExecutable -or
      $Application.GetAttribute('EntryPoint') -cne 'Windows.FullTrustApplication') {
    throw 'Store Application Id, executable, or entry point is not exact.'
  }
  $RunFullTrust = @($Manifest.SelectNodes(
    "/*[local-name()='Package']/*[local-name()='Capabilities']/*[local-name()='Capability' and @Name='runFullTrust']"
  ))
  if ($RunFullTrust.Count -ne 1) { throw 'Manifest must declare exactly one runFullTrust capability.' }
  $Languages = @($Manifest.SelectNodes(
    "/*[local-name()='Package']/*[local-name()='Resources']/*[local-name()='Resource']"
  ) | ForEach-Object { $_.GetAttribute('Language') } | Sort-Object)
  if ((Compare-Object @('en-US', 'zh-CN') $Languages)) {
    throw 'Manifest language inventory must be exactly en-US and zh-CN.'
  }

  foreach ($AssetName in $ExpectedAssets.Keys) {
    $AssetPath = Join-Path $UnpackedRoot "assets\$AssetName"
    if (-not (Test-Path -LiteralPath $AssetPath -PathType Leaf)) {
      throw "Required Store asset is missing: $AssetName"
    }
    $Dimensions = Get-PngDimensions -Path $AssetPath
    if ($Dimensions[0] -ne $ExpectedAssets[$AssetName][0] -or
        $Dimensions[1] -ne $ExpectedAssets[$AssetName][1]) {
      throw "Store asset dimensions are wrong for $AssetName."
    }
  }
  foreach ($Locale in @('en-US.pak', 'zh-CN.pak')) {
    if (-not (Test-Path -LiteralPath (Join-Path $UnpackedRoot "app\locales\$Locale") -PathType Leaf)) {
      throw "Packaged Electron locale is missing: $Locale"
    }
  }
  foreach ($LegalFile in @('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md')) {
    $LegalPath = Join-Path $UnpackedRoot "app\resources\legal\$LegalFile"
    if (-not (Test-Path -LiteralPath $LegalPath -PathType Leaf)) {
      throw "Packaged legal file is missing: $LegalFile"
    }
  }
  $NoticeText = Get-Content -LiteralPath (Join-Path $UnpackedRoot 'app\resources\legal\NOTICE') -Raw
  if ($NoticeText -notmatch 'Copyright 2026 LAI ZEYU \(来泽宇\)') {
    throw 'Packaged NOTICE does not preserve exact bilingual authorship.'
  }

  $StoreExe = Join-Path $UnpackedRoot $ExpectedExecutable
  if (-not (Test-Path -LiteralPath $StoreExe -PathType Leaf)) {
    throw 'Store package main executable is missing.'
  }
  $StoreExeHash = (Get-FileHash -LiteralPath $StoreExe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($StoreExeHash -cne $ExpectedExecutableSha256) {
    throw 'The AppX executable differs from the exact packaged executable tested twice.'
  }
  $VersionInfo = (Get-Item -LiteralPath $StoreExe).VersionInfo
  if ($VersionInfo.ProductName -cne 'Calorie Steward by LAI ZEYU' -or
      $VersionInfo.LegalCopyright -notmatch 'LAI ZEYU.*来泽宇') {
    throw 'Compiled executable product or author metadata is not exact.'
  }
  $FuseText = (& node windows-app/node_modules/@electron/fuses/dist/bin.js read --app $StoreExe 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Packaged Electron fuse inspection failed.' }
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
    if (-not $FuseText.Contains($ExpectedFuse)) {
      throw "Packaged Electron fuse mismatch: $ExpectedFuse"
    }
  }

  $Files = @(Get-ChildItem -LiteralPath $UnpackedRoot -Recurse -File -Force | Sort-Object FullName)
  if ($Files.Count -lt 20 -or $Files.Count -gt 20000) {
    throw "Unpacked file count is outside the reviewed bound: $($Files.Count)"
  }
  $TotalBytes = [long](($Files | Measure-Object -Property Length -Sum).Sum)
  if ($TotalBytes -le 0 -or $TotalBytes -gt 1500MB) {
    throw "Unpacked byte count is outside the reviewed bound: $TotalBytes"
  }
  $InventoryLines = @($Files | ForEach-Object {
    $Relative = [IO.Path]::GetRelativePath($UnpackedRoot, $_.FullName).Replace('\', '/')
    if ($Relative.StartsWith('../') -or [IO.Path]::IsPathRooted($Relative)) {
      throw "Inventory path escaped the unpack root: $Relative"
    }
    $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$Hash  $($_.Length)  $Relative"
  })
  $InventoryPath = Join-Path $EvidenceRoot 'unpacked-inventory.txt'
  [IO.File]::WriteAllText(
    $InventoryPath,
    ($InventoryLines -join "`n") + "`n",
    [Text.UTF8Encoding]::new($false)
  )
  $InventoryHash = (Get-FileHash -LiteralPath $InventoryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $ManifestHash = (Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $AppxHashAfter = (Get-FileHash -LiteralPath $Appx -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($AppxHashAfter -cne $AppxHashBefore) { throw 'Inspection changed the source AppX bytes.' }

  [ordered]@{
    schemaVersion = 1
    round = $Round
    product = 'Calorie Steward by LAI ZEYU'
    author = 'LAI ZEYU（来泽宇）'
    publisherDisplayName = 'LAI ZEYU'
    identityName = $ExpectedIdentity
    publisher = $ExpectedPublisher
    version = $ExpectedVersion
    architecture = 'x64'
    applicationId = 'CalorieSteward'
    executable = $ExpectedExecutable
    sourceCommit = $SourceCommit
    appxFile = (Split-Path -Leaf $Appx)
    appxSha256 = $AppxHashBefore
    manifestSha256 = $ManifestHash
    executableSha256 = $StoreExeHash
    unpackedInventorySha256 = $InventoryHash
    unpackedFileCount = $Files.Count
    unpackedBytes = $TotalBytes
    makeAppxSha256 = (Get-FileHash -LiteralPath $MakeAppx.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    makeAppxFileVersion = [string]$MakeAppx.VersionInfo.FileVersion
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 4 | Set-Content `
    -LiteralPath (Join-Path $EvidenceRoot 'store-inspection.json') -Encoding UTF8
  Write-Host "Store submission static inspection round $Round passed: $AppxHashBefore"
} catch {
  $PrimaryError = $_
} finally {
  if (Test-Path -LiteralPath $WorkRoot) {
    try {
      $ResolvedWorkRoot = (Resolve-Path -LiteralPath $WorkRoot).Path.TrimEnd('\')
      $ResolvedParent = [IO.Directory]::GetParent($ResolvedWorkRoot).FullName.TrimEnd('\')
      if (-not [string]::Equals($ResolvedParent, $RunnerTemp, [StringComparison]::OrdinalIgnoreCase) -or
          (Split-Path -Leaf $ResolvedWorkRoot) -notlike "calorie-store-inspect-$Round-*") {
        throw 'Refusing cleanup outside the exact RUNNER_TEMP inspection root.'
      }
      Assert-NoReparsePoint -Root $ResolvedWorkRoot
      Remove-Item -LiteralPath $ResolvedWorkRoot -Recurse -Force
      if (Test-Path -LiteralPath $ResolvedWorkRoot) { throw 'Inspection cleanup did not remove its work root.' }
    } catch {
      if ($PrimaryError) {
        throw "Store inspection failed: $($PrimaryError.Exception.Message); cleanup also failed: $($_.Exception.Message)"
      }
      throw
    }
  }
}
if ($PrimaryError) { throw $PrimaryError }
