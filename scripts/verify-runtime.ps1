param(
  [int]$Port = 3080,
  [string]$DshHome = "$env:USERPROFILE\.dsh"
)

$ErrorActionPreference = 'Stop'

$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCommand) {
  try {
    $dshVersion = (& $dshCommand.Source --version 2>$null | Select-Object -First 1)
    Write-Output "DSH version: $dshVersion"
  } catch {
    Write-Output 'DSH version: unavailable'
  }
} else {
  Write-Output 'DSH version: command not found'
}

try {
  $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 5
  Write-Output "DSH HTTP: $([int]$response.StatusCode)"
} catch {
  Write-Error "DSH Web 服务不可用: $($_.Exception.Message)"
  exit 1
}

$hasBootSignature = ([string]$response.Content -match '__DSH_BOOT__') -and ([string]$response.Content -match 'DeepSeek\s+Harness')
Write-Output "DSH web signature: $hasBootSignature"
if (-not $hasBootSignature) {
  Write-Error "3080 返回的不是可识别的 DSH Web 页面"
  exit 1
}

$probeBody = @{ type = 'client-request'; rpcId = "dshgui-verify-$PID"; method = 'session.list'; payload = @{} } | ConvertTo-Json -Compress
try {
  $rpcResponse = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/api/session.list" -ContentType 'application/json' -Body $probeBody -TimeoutSec 5
  $rpc = $rpcResponse.Content | ConvertFrom-Json
  $rpcOk = ($rpc.type -eq 'server-response') -and ($rpc.result.ok -eq $true)
  Write-Output "DSH session.list RPC: $rpcOk"
  if (-not $rpcOk) { exit 1 }
} catch {
  Write-Error "DSH API 身份校验失败: $($_.Exception.Message)"
  exit 1
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $isDsh = $process.CommandLine -match '@deepseek-ai[\\/]dsh' -and $process.CommandLine -match '(?:^|\s|["''])web(?:\s|$|["''])'
  Write-Output "Listener PID: $($listener.OwningProcess) DSH: $isDsh"
  if (-not $isDsh) {
    Write-Error '监听端口的进程不是可识别的 DSH 服务'
    exit 1
  }
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
