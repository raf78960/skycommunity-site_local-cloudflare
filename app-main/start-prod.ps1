# Lance le site + le bot EN LOCAL, publiés sur Internet par un Cloudflare Tunnel.
# Un seul port est exposé : 8001 (le backend sert aussi le site compilé).
# Prérequis : MongoDB, Python, Node, cloudflared (voir docs/LOCAL_CLOUDFLARE.md). Utilisation : start-prod.bat
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$BotDir = if ($env:SKYBOT_DIR) { $env:SKYBOT_DIR } else { 'C:\SkyBot' }
$BackendDir = Join-Path $Root 'backend'; $FrontendDir = Join-Path $Root 'frontend'
$Problems = New-Object System.Collections.ArrayList

function Test-Port([int]$Port) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $Port); $c.Close(); $true } catch { $false } }
function Wait-Port([int]$Port, [int]$Sec) { $t = 0; while (-not (Test-Port $Port)) { Start-Sleep 1; $t++; if ($t -ge $Sec) { return $false } }; $true }
function Start-Tab([string]$Title, [string]$Dir, [string]$Cmd) {
    Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command', "`$Host.UI.RawUI.WindowTitle='$Title'; Set-Location -LiteralPath '$Dir'; $Cmd" | Out-Null
}
function Add-Problem([string]$m) { [void]$Problems.Add($m); Write-Host "  [!] $m" -ForegroundColor Red }

# --- 0. Verifications ---
if (-not (Test-Path (Join-Path $BackendDir '.env'))) { Add-Problem 'backend\.env manquant (copie backend\.env.example).' }
$envText = if (Test-Path (Join-Path $BackendDir '.env')) { Get-Content (Join-Path $BackendDir '.env') -Raw } else { '' }
if ($envText -match '(?m)^ALLOW_TEST_LOGIN\s*=\s*true') { Add-Problem 'ALLOW_TEST_LOGIN=true : a retirer, le site est public !' }

# --- 1. MongoDB ---
Write-Host '[1/5] MongoDB...' -ForegroundColor Cyan
if (-not (Test-Port 27017)) {
    $svc = Get-Service | Where-Object { $_.Name -like '*mongo*' } | Select-Object -First 1
    if ($svc) { try { Start-Service $svc.Name -ErrorAction Stop } catch { Add-Problem 'Demarre le service MongoDB (admin requis).' } }
    else { Add-Problem 'MongoDB introuvable : installe MongoDB Community Server (service Windows).' }
    [void](Wait-Port 27017 30)
}
if (Test-Port 27017) { Write-Host '  OK' -ForegroundColor Green }

# --- 2. Site compile ---
Write-Host '[2/5] Frontend (build)...' -ForegroundColor Cyan
$dist = Join-Path $FrontendDir 'dist\index.html'
if (-not (Test-Path $dist) -or $args -contains '-rebuild') {
    Push-Location $FrontendDir
    if (-not (Test-Path 'node_modules')) { npm ci }
    npm run build
    Pop-Location
}
if (Test-Path $dist) { Write-Host '  OK (frontend\dist)' -ForegroundColor Green } else { Add-Problem 'Build du frontend echoue (voir ci-dessus).' }

# --- 3. Backend (127.0.0.1:8001) ---
Write-Host '[3/5] Backend + site (port 8001)...' -ForegroundColor Cyan
if (Test-Port 8001) { Write-Host '  deja demarre' -ForegroundColor Green } else {
    $py = Join-Path $BackendDir '.venv\Scripts\python.exe'; if (-not (Test-Path $py)) { $py = 'python' }
    Start-Tab 'Backend 8001' $BackendDir "& '$py' -m uvicorn server:app --host 127.0.0.1 --port 8001 --workers 1"
    if (Wait-Port 8001 40) { Write-Host '  OK' -ForegroundColor Green } else { Add-Problem 'Backend : port 8001 muet (voir sa fenetre).' }
}

# --- 4. Bot ---
Write-Host '[4/5] Bot Discord...' -ForegroundColor Cyan
if (Test-Port 8080) { Write-Host '  deja demarre' -ForegroundColor Green }
elseif (-not (Test-Path (Join-Path $BotDir 'bot.py'))) { Add-Problem "bot.py introuvable dans $BotDir (definis SKYBOT_DIR)." }
else { Start-Tab 'Bot Discord' $BotDir 'python bot.py'; Write-Host '  lance' -ForegroundColor Green }

# --- 5. Cloudflare Tunnel ---
Write-Host '[5/5] Cloudflare Tunnel...' -ForegroundColor Cyan
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { Add-Problem 'cloudflared introuvable (winget install Cloudflare.cloudflared).' }
else {
    $cfg = Join-Path $Root 'deploy\cloudflared-config.yml'
    if (Test-Path $cfg) { Start-Tab 'Cloudflare Tunnel' $Root "cloudflared tunnel --config '$cfg' run"; Write-Host '  tunnel nomme lance' -ForegroundColor Green }
    else {
        Write-Host '  pas de deploy\cloudflared-config.yml : tunnel RAPIDE (adresse aleatoire, change a chaque lancement)' -ForegroundColor Yellow
        Start-Tab 'Cloudflare Tunnel' $Root 'cloudflared tunnel --url http://127.0.0.1:8001'
    }
}

Write-Host ''
if ($Problems.Count -eq 0) { Write-Host 'Tout est lance. Local : http://127.0.0.1:8001' -ForegroundColor Green }
else { Write-Host 'Problemes :' -ForegroundColor Yellow; $Problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow } }
Read-Host 'Entree pour fermer cette fenetre (les autres fenetres restent ouvertes)'
