# 打包安装包 —— 必须是 .NET ZipArchive，不能用 Compress-Archive
#
# 原因：宿主解包用 yauzl 且开启 strictFileNames:true，条目名中的反斜杠会被判非法，
# 报 INSTALL_ARCHIVE_INVALID「Archive could not be read safely.」。
# PowerShell 5.1 的 Compress-Archive 写入的条目名用 \ 分隔，必定触发该错误。
# 本脚本显式用 / 作为条目名分隔符。

param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Out  = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Root = (Resolve-Path $Root).Path

# Zip name follows the manifest version, so the file name cannot drift from the version.
if (-not $Out) {
  $ver = (Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'manifest.json') | ConvertFrom-Json).version
  $Out = Join-Path $Root ("shiyi-v{0}.zip" -f $ver)
}

$files = New-Object System.Collections.Generic.List[string]
foreach ($f in @('index.js', 'manifest.json', 'package.json')) {
  $p = Join-Path $Root $f
  if (-not (Test-Path $p)) { throw "missing required file: $p" }
  [void]$files.Add($p)
}
foreach ($d in @('lib', 'routes', 'ui')) {
  $dir = Join-Path $Root $d
  if (-not (Test-Path $dir)) { throw "missing required dir: $dir" }
  Get-ChildItem -Path $dir -Recurse -File | ForEach-Object { [void]$files.Add($_.FullName) }
}

if (Test-Path $Out) { Remove-Item $Out -Force }
$fs = [IO.File]::Open($Out, [IO.FileMode]::Create)
try {
  $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($f in $files) {
      $rel = $f.Substring($Root.Length + 1).Replace('\', '/')
      if ($rel.Contains('\')) { throw "entry name must use '/': $rel" }
      $entry = $zip.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
      $es = $entry.Open()
      try {
        $bytes = [IO.File]::ReadAllBytes($f)
        $es.Write($bytes, 0, $bytes.Length)
      } finally { $es.Dispose() }
    }
  } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

$z = [IO.Compression.ZipFile]::OpenRead($Out)
try {
  $bad = @($z.Entries | Where-Object { $_.FullName.Contains('\') })
  if ($bad.Count -gt 0) { throw "entry name contains backslash: $($bad[0].FullName)" }
  $manifestRoot = @($z.Entries | Where-Object { $_.FullName -eq 'manifest.json' }).Count
  $count = $z.Entries.Count
} finally { $z.Dispose() }

if ($manifestRoot -ne 1) { throw "manifest.json must sit at archive root" }
$sha = (Get-FileHash -Path $Out -Algorithm SHA256).Hash.ToLower()
Write-Output ("entries={0} manifestRoot={1} size={2}" -f $count, $manifestRoot, (Get-Item $Out).Length)
Write-Output ("sha256={0}" -f $sha)
Write-Output ("out={0}" -f $Out)
