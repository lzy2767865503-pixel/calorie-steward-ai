$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Import-NamedFunction {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$FunctionName
  )
  $Tokens = $null
  $Errors = $null
  $Ast = [Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path -LiteralPath $ScriptPath).Path,
    [ref]$Tokens,
    [ref]$Errors
  )
  if ($Errors.Count -gt 0) { throw ($Errors | Out-String) }
  $Definition = $Ast.Find({
    param($Node)
    $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $Node.Name -ceq $FunctionName
  }, $true)
  if (-not $Definition) { throw "Function not found: $FunctionName" }
  Set-Item -LiteralPath "Function:\global:$FunctionName" -Value $Definition.Body.GetScriptBlock()
}

function Assert-ExpectedOutcome {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$ShouldPass,
    [Parameter(Mandatory = $true)][ScriptBlock]$Operation
  )
  $Passed = $true
  $Detail = ''
  try { & $Operation } catch { $Passed = $false; $Detail = $_.Exception.Message }
  if ($Passed -ne $ShouldPass) {
    throw "$Name expected pass=$ShouldPass but observed pass=$Passed. $Detail"
  }
  Write-Host "$Name`: $(if ($Passed) { 'ACCEPT' } else { 'REJECT' })"
}

$ScriptsRoot = Join-Path $PSScriptRoot '..\scripts'
Import-NamedFunction `
  -ScriptPath (Join-Path $ScriptsRoot 'windows-lifecycle.ps1') `
  -FunctionName 'Assert-SignToolOutputPolicy'
Import-NamedFunction `
  -ScriptPath (Join-Path $ScriptsRoot 'windows-store-lifecycle.ps1') `
  -FunctionName 'Assert-WackXmlPass'
Import-NamedFunction `
  -ScriptPath (Join-Path $ScriptsRoot 'windows-store-lifecycle.ps1') `
  -FunctionName 'Assert-WackReportCandidateBinding'

$Digest = 'a' * 64
$ValidCompactSignTool = @"
Index  Algorithm  Timestamp
0      sha256     RFC3161
Successfully verified: fixture.exe
"@
$ValidVerboseSignTool = @"
Signature Index: 0 (Primary Signature)
Hash of file (sha256): $Digest
Number of signatures successfully Verified: 1
Number of warnings: 0
Number of errors: 0
"@
$SignToolCases = @(
  @{ Name = 'signtool-valid'; Pass = $true; Compact = $ValidCompactSignTool; Verbose = $ValidVerboseSignTool },
  @{ Name = 'signtool-sha1'; Pass = $false; Compact = $ValidCompactSignTool -replace 'sha256', 'sha1'; Verbose = $ValidVerboseSignTool -replace 'sha256', 'sha1' -replace $Digest, ('b' * 40) },
  @{ Name = 'signtool-legacy-timestamp'; Pass = $false; Compact = $ValidCompactSignTool -replace 'RFC3161', 'Authenticode'; Verbose = $ValidVerboseSignTool },
  @{ Name = 'signtool-extra-signature'; Pass = $false; Compact = $ValidCompactSignTool + "`n1 sha256 RFC3161"; Verbose = $ValidVerboseSignTool + "`nSignature Index: 1`nHash of file (sha256): $Digest" },
  @{ Name = 'signtool-warning'; Pass = $false; Compact = $ValidCompactSignTool; Verbose = $ValidVerboseSignTool -replace 'Number of warnings: 0', 'Number of warnings: 1' },
  @{ Name = 'signtool-missing-digest'; Pass = $false; Compact = $ValidCompactSignTool; Verbose = $ValidVerboseSignTool -replace '(?m)^Hash of file.*\r?\n', '' }
)
foreach ($Case in $SignToolCases) {
  Assert-ExpectedOutcome -Name $Case.Name -ShouldPass $Case.Pass -Operation {
    Assert-SignToolOutputPolicy `
      -CompactOutput $Case.Compact `
      -VerboseOutput $Case.Verbose `
      -BinaryPath 'fixture.exe'
  }
}

$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ('calorie-wack-policy-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($TempRoot)
try {
  $Padding = 'x' * 700
  $WackCases = @(
    @{ Name='wack-valid'; Pass=$true; Xml="<REPORT OVERALL_RESULT='PASS' PARTIAL_RUN='FALSE' LATEST_VERSION='TRUE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='Static validation'><RESULT>PASS</RESULT></TEST><TEST INDEX='2' NAME='Optional capability'><RESULT>NOT APPLICABLE</RESULT></TEST><!--$Padding--></REPORT>" },
    @{ Name='wack-stale-kit'; Pass=$false; Xml="<REPORT OVERALL_RESULT='PASS' PARTIAL_RUN='FALSE' LATEST_VERSION='FALSE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='A'><RESULT>PASS</RESULT></TEST><!--$Padding--></REPORT>" },
    @{ Name='wack-partial-run'; Pass=$false; Xml="<REPORT OVERALL_RESULT='PASS' PARTIAL_RUN='TRUE' LATEST_VERSION='TRUE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='A'><RESULT>PASS</RESULT></TEST><!--$Padding--></REPORT>" },
    @{ Name='wack-overall-fail'; Pass=$false; Xml="<REPORT OVERALL_RESULT='FAIL' PARTIAL_RUN='FALSE' LATEST_VERSION='TRUE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='A'><RESULT>PASS</RESULT></TEST><!--$Padding--></REPORT>" },
    @{ Name='wack-empty-result'; Pass=$false; Xml="<REPORT OVERALL_RESULT='PASS' PARTIAL_RUN='FALSE' LATEST_VERSION='TRUE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='A'><RESULT></RESULT></TEST><!--$Padding--></REPORT>" },
    @{ Name='wack-duplicate-index'; Pass=$false; Xml="<REPORT OVERALL_RESULT='PASS' PARTIAL_RUN='FALSE' LATEST_VERSION='TRUE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='A'><RESULT>PASS</RESULT></TEST><TEST INDEX='1' NAME='B'><RESULT>PASS</RESULT></TEST><!--$Padding--></REPORT>" },
    @{ Name='wack-duplicate-name'; Pass=$false; Xml="<REPORT OVERALL_RESULT='PASS' PARTIAL_RUN='FALSE' LATEST_VERSION='TRUE' VERSION='10.0.26100.1'><TEST INDEX='1' NAME='A'><RESULT>PASS</RESULT></TEST><TEST INDEX='2' NAME='A'><RESULT>PASS</RESULT></TEST><!--$Padding--></REPORT>" }
  )
  foreach ($Case in $WackCases) {
    $Fixture = Join-Path $TempRoot ($Case.Name + '.xml')
    [IO.File]::WriteAllText($Fixture, $Case.Xml, [Text.UTF8Encoding]::new($false))
    Assert-ExpectedOutcome -Name $Case.Name -ShouldPass $Case.Pass -Operation {
      $null = Assert-WackXmlPass -ReportPath $Fixture
    }
  }

  $global:IdentityName = 'LAIZEYU.CalorieStewardbyLAIZEYU'
  $global:Publisher = 'CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8'
  function global:Register-ExactAppCertInstallLocation {
    param([string]$PackageFullName, [string]$RawInstallLocation, [switch]$AllowAlreadyRemoved)
    return $RawInstallLocation
  }
  $PackageManifest = @"
<PackageManifest PackageFullName='LAIZEYU.CalorieStewardbyLAIZEYU_1.2.3.0_x64__jex0hdpdrk7qw'>
  <Identity Name='$IdentityName' Publisher='$Publisher' Version='1.2.3.0' ProcessorArchitecture='x64'/>
  <Properties><PublisherDisplayName>LAI ZEYU</PublisherDisplayName></Properties>
  <Applications><Application Id='CalorieSteward' Executable='Calorie Steward by LAI ZEYU.exe'/></Applications>
</PackageManifest>
"@
  $BindingCases = @(
    @{ Name='wack-binding-valid'; Pass=$true; Programs="<Program Source='AppxPackage' Name='$IdentityName' Publisher='$Publisher' RootDirPath='C:\WINDOWS\temp\appcert_case\LAIZEYU.CalorieStewardbyLAIZEYU_1.2.3.0_x64__jex0hdpdrk7qw'>$PackageManifest</Program>" },
    @{ Name='wack-binding-extra-appx'; Pass=$false; Programs="<Program Source='AppxPackage' Name='$IdentityName' Publisher='$Publisher' RootDirPath='C:\WINDOWS\temp\appcert_case\LAIZEYU.CalorieStewardbyLAIZEYU_1.2.3.0_x64__jex0hdpdrk7qw'>$PackageManifest</Program><Program Source='AppxPackage' Name='Other.App' Publisher='CN=Other'/>" },
    @{ Name='wack-binding-wrong-program-identity'; Pass=$false; Programs="<Program Source='AppxPackage' Name='Other.App' Publisher='$Publisher' RootDirPath='C:\WINDOWS\temp\appcert_case\LAIZEYU.CalorieStewardbyLAIZEYU_1.2.3.0_x64__jex0hdpdrk7qw'>$PackageManifest</Program>" }
  )
  foreach ($Case in $BindingCases) {
    $Fixture = Join-Path $TempRoot ($Case.Name + '.xml')
    $Xml = "<REPORT><Installed_Programs>$($Case.Programs)</Installed_Programs></REPORT>"
    [IO.File]::WriteAllText($Fixture, $Xml, [Text.UTF8Encoding]::new($false))
    Assert-ExpectedOutcome -Name $Case.Name -ShouldPass $Case.Pass -Operation {
      $null = Assert-WackReportCandidateBinding -ReportPath $Fixture
    }
  }

  $StoreLifecycleSource = [IO.File]::ReadAllText((Join-Path $ScriptsRoot 'windows-store-lifecycle.ps1'))
  if ([regex]::Matches($StoreLifecycleSource, 'OrdinalIgnoreCase').Count -lt 2) {
    throw 'AppCert Windows Temp ownership comparisons must remain case-insensitive.'
  }
} finally {
  if (Test-Path -LiteralPath $TempRoot) { [IO.Directory]::Delete($TempRoot, $true) }
}

Write-Host 'Windows release policy fixtures: 16/16 expected outcomes.'
