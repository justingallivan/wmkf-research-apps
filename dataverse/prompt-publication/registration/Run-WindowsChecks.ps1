# Offline only. Run from Windows PowerShell in the extracted handoff directory.
# Requires .NET Framework 4.8. Strong-name verification additionally needs sn.exe.
param([string]$StrongNameTool = 'sn.exe')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'handoff-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    if ($entry.path -match '(^/|\\|(^|/)\.\.(/|$)|:)') { throw 'Invalid manifest path' }
    $file = Join-Path $root $entry.path
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Hash mismatch: $($entry.path)" }
}
$expected = @($manifest.files | ForEach-Object { $_.path }) + @('handoff-manifest.json')
foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    if ($relative -notin $expected) { throw "Unexpected handoff file: $relative" }
}
$release = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release
if ($release.Release -lt 528040) { throw '.NET Framework 4.8 or higher is required' }
$sn = Get-Command $StrongNameTool -ErrorAction Stop
$checks = Join-Path $root 'checks/Checks.exe'
$fixture = Join-Path $root 'fixtures/fingerprints-v1.json'
$savedPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $checkOutput = & $checks $fixture 2>&1
    $checkExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $savedPreference }
$checkOutput | Write-Output
if ($checkExit -ne 0) { throw 'Framework checks failed; no registration is permitted' }
# The signed package assemblies are separate from the unsigned local check harness.
$signatureOutput = @()
foreach ($name in @('Wmkf.PromptPublication.Transport.dll', 'Newtonsoft.Json.dll')) {
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $sn.Source '-vf' (Join-Path $root "signed/$name") 2>&1
        $snExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    $output | Write-Output
    $signatureOutput += @($output | ForEach-Object { $_.ToString() })
    if ($snExit -ne 0) { throw "Strong-name verification failed: $name" }
}
$result = [ordered]@{ status='OFFLINE_WINDOWS_CHECKS_PASSED'; observedAt=(Get-Date).ToUniversalTime().ToString('o'); packageSourceCommit=$manifest.packageSourceCommit; sourcePacketSha256=$manifest.sourcePacketSha256; packageSha256=$manifest.packageSha256; frameworkRelease=$release.Release; checkOutput=($checkOutput -join "`n"); signatureOutput=$signatureOutput; tenantProof=$false; deploymentAuthorized=$false }
$target = Join-Path $root 'windows-check-result.json'
if (Test-Path -LiteralPath $target) { throw 'Result exists; retain it and use a fresh extraction for another run' }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $target -Encoding UTF8
Write-Output "Return windows-check-result.json and complete console output. No tenant connection occurred."
