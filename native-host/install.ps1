$ErrorActionPreference="Stop"
$HostName="com.videoflow.fresh"
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir=Join-Path $env:LOCALAPPDATA "VideoFlowNative"
$BuildDir=Join-Path $InstallDir "build"
$PublishDir=Join-Path $InstallDir "publish"
$Exe=Join-Path $InstallDir "VideoFlowNative.exe"
$Manifest=Join-Path $InstallDir "$HostName.json"

Write-Host "=== VideoFlow Fresh Quality Bridge ==="
$ff=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ffPath=if($ff){$ff.Source}else{Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffmpeg.exe"}
if(!(Test-Path $ffPath)){throw "FFmpeg not found."}
Write-Host "FFmpeg: $ffPath"
$dotnet=Get-Command dotnet.exe -ErrorAction SilentlyContinue
if(!$dotnet){throw "dotnet SDK not found."}
Write-Host "dotnet: $(& dotnet --version)"
$id=Read-Host "Paste the VideoFlow extension ID from chrome://extensions"
if($id -notmatch '^[a-p]{32}$'){throw "Invalid extension ID."}

Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
Copy-Item "$Root\Program.cs" "$BuildDir\Program.cs"
Copy-Item "$Root\VideoFlowNative.csproj" "$BuildDir\VideoFlowNative.csproj"

Push-Location $BuildDir
try {
  dotnet restore
  if($LASTEXITCODE -ne 0){throw "dotnet restore failed."}
  dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o $PublishDir
  if($LASTEXITCODE -ne 0){throw "dotnet publish failed."}
} finally { Pop-Location }

Copy-Item "$PublishDir\VideoFlowNative.exe" $Exe -Force
@{name=$HostName;description="VideoFlow Fresh quality FFmpeg bridge";path=$Exe;type="stdio";allowed_origins=@("chrome-extension://$id/")} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $Manifest
$key="HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item $key -Force | Out-Null
Set-ItemProperty $key -Name "(default)" -Value $Manifest
Write-Host "SUCCESS: Quality + Progress bridge installed."
Write-Host "EXE: $Exe"
Write-Host "Manifest: $Manifest"
Write-Host "Restart Chrome completely."
