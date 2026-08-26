param(
  [int]$Port = 3080,
  [string]$DshHome = "$env:USERPROFILE\.dsh"
)

$ErrorActionPreference = 'Stop'

try {
  $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 5
  Write-Output "DSH HTTP: $([int]$response.StatusCode)"
} catch {
  Write-Error "DSH Web 服务不可用: $($_.Exception.Message)"
  exit 1
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $isDsh = $process.CommandLine -match '@deepseek-ai[\\/]dsh' -and $process.CommandLine -match '(?:^|\s|["''])web(?:\s|$|["''])'
  Write-Output "Listener PID: $($listener.OwningProcess) DSH: $isDsh"
}

$sessionDir = Join-Path $DshHome 'sessions'
if (Test-Path -LiteralPath $sessionDir) {
  $sessions = Get-ChildItem -LiteralPath $sessionDir -Recurse -File -Filter '*.zstd'
  $bytes = ($sessions | Measure-Object -Property Length -Sum).Sum
  Write-Output "Sessions: $($sessions.Count), bytes: $bytes"
} else {
  Write-Output 'Sessions: directory not found'
}

$searchDb = Join-Path $DshHome 'session-search.sqlite'
if (Test-Path -LiteralPath $searchDb) {
  Write-Output "Search DB bytes: $((Get-Item -LiteralPath $searchDb).Length)"
  $wal = "$searchDb-wal"
  if (Test-Path -LiteralPath $wal) { Write-Output "Search WAL bytes: $((Get-Item -LiteralPath $wal).Length)" }
}

$credentialFile = Join-Path $DshHome '.credentials.yaml'
Write-Output "Credentials file present: $(Test-Path -LiteralPath $credentialFile) (contents not printed)"
