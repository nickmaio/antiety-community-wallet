param([string]$PackageRoot, [string]$ArchivePath)

$ErrorActionPreference = 'Stop'
$clientRoot = Split-Path -Parent $PSScriptRoot
if (-not $PackageRoot) { $PackageRoot = Join-Path $clientRoot 'dist-wallet-recovery' }
if (-not $ArchivePath) { $ArchivePath = Join-Path $clientRoot 'wallet-recovery-ethereum.zip' }
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).ProviderPath.TrimEnd('\', '/')
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
if ($ArchivePath.StartsWith($PackageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Put the archive outside the recovery package directory'
}
$files = @('index.html', 'favicon.ico', 'assets', 'launcher', 'start.mjs', 'start.ps1', 'start.cmd',
    'README.md', 'RECOVERY-BUILD.json', '_headers', 'SHA256SUMS.json') | ForEach-Object { Join-Path $PackageRoot $_ }
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) { throw 'Build the recovery package before archiving it' }
}
$manifestPath = Join-Path $PackageRoot 'SHA256SUMS.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne 1 -or $manifest.network -ne 'Ethereum mainnet') { throw 'Unsupported recovery manifest' }
if (($manifest.chainIds -join ',') -ne '1') { throw 'Unsupported recovery networks' }
$expected = @{}
foreach ($entry in $manifest.files.PSObject.Properties) {
    $name = $entry.Name
    $target = [IO.Path]::GetFullPath((Join-Path $PackageRoot $name))
    if (-not $target.StartsWith($PackageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Recovery manifest path escaped the package'
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) {
        throw 'Recovery file changed after manifest generation'
    }
    $expected[$name] = $entry.Value
}
$expected['SHA256SUMS.json'] = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
Compress-Archive -LiteralPath $files -DestinationPath $ArchivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
    $seen = @{}
    foreach ($entry in $archive.Entries) {
        if (-not $entry.Name) { continue }
        $name = $entry.FullName.Replace('\', '/')
        if (-not $expected.ContainsKey($name) -or $seen.ContainsKey($name)) { throw 'Unexpected or duplicate archive file' }
        $stream = $entry.Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $hasher.Dispose() }
        if ($actual -ne $expected[$name]) { throw 'Recovery archive content failed checksum verification' }
        $seen[$name] = $true
    }
    if ($seen.Count -ne $expected.Count) { throw 'Recovery archive is incomplete' }
} finally { $archive.Dispose() }
Write-Output ('Recovery archive: ' + $ArchivePath)
Write-Output ('Verified archive files: ' + $expected.Count)
Write-Output ('SHA-256: ' + (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash)
