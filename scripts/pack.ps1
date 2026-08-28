param(
  [switch]$All
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packager = Join-Path $root 'node_modules\.bin\electron-packager.cmd'
$electronPackage = Join-Path $root 'node_modules\electron\package.json'

if (-not (Test-Path -LiteralPath $packager)) { throw 'electron-packager is not installed. Run npm ci first.' }
if (-not (Test-Path -LiteralPath $electronPackage)) { throw 'Electron is not installed. Run npm ci first.' }

$version = (Get-Content -LiteralPath $electronPackage -Raw -Encoding utf8 | ConvertFrom-Json).version
$args = @(
  '.', 'DeepSeek Harness Desktop', '--icon=icon.ico', '--out=release', '--overwrite', '--prune=true',
  '--ignore=\.git', '--ignore=\.github', '--ignore=release', '--ignore=tests', '--ignore=scripts',
  # Keep local configuration, DSH data, diagnostics, and generated cache out of
  # the application archive even when the source directory contains them.
  '--ignore=\.env', '--ignore=\.dsh', '--ignore=sessions', '--ignore=session-search\.sqlite',
  '--ignore=wallpaper-cache', '--ignore=dsh-server\.json', '--ignore=wallpaper\.json',
  '--ignore=wallpaper-paths\.json', '--ignore=\.log'
)
if ($All) {
  $args += '--all'
} else {
  $args += '--platform=win32'
  $args += '--arch=x64'
}

$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron\Cache'
$zip = Get-ChildItem -LiteralPath $cacheRoot -Recurse -File -Filter "electron-v$version-win32-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($zip) {
  $args += "--electron-zip-dir=$($zip.Directory.FullName)"
  Write-Output "Using cached Electron $version"
} else {
  Write-Output "Electron $version is not cached; electron-packager will download it if network access is available."
}

Push-Location $root
try {
  & $packager @args
  if ($LASTEXITCODE -ne 0) { throw "electron-packager failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
