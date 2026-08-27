param(
  [string]$ExtensionId,
  [string]$InstallRoot,
  [switch]$AutoUpdate
)

$ErrorActionPreference="Stop"
$HostName="com.videoflow.fresh"
$SourceRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir=Join-Path $env:LOCALAPPDATA "VideoFlowNative"
$MainBuild=Join-Path $InstallDir "build"
$UpdaterBuild=Join-Path $InstallDir "updater-build"
$PublishDir=Join-Path $InstallDir "publish"
$UpdaterPublishDir=Join-Path $InstallDir "updater-publish"
$Exe=Join-Path $InstallDir "VideoFlowNative.exe"
$UpdaterExe=Join-Path $InstallDir "VideoFlowUpdater.exe"
$Manifest=Join-Path $InstallDir "$HostName.json"

Write-Host "=== VideoFlow Native Bridge + Updater ==="

$ff=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ffPath=if($ff){$ff.Source}else{Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffmpeg.exe"}
if(!(Test-Path $ffPath)){throw "FFmpeg not found."}
Write-Host "FFmpeg: $ffPath"

$dotnet=Get-Command dotnet.exe -ErrorAction SilentlyContinue
if(!$dotnet){throw "dotnet SDK not found."}
Write-Host "dotnet: $(& dotnet --version)"

if([string]::IsNullOrWhiteSpace($ExtensionId)){
  $ExtensionId=Read-Host "Paste the VideoFlow extension ID from chrome://extensions"
}
if($ExtensionId -notmatch '^[a-p]{32}$'){throw "Invalid extension ID."}

if([string]::IsNullOrWhiteSpace($InstallRoot)){
  $InstallRoot=(Resolve-Path (Join-Path $SourceRoot "..")).Path
}
$InstallRoot=(Resolve-Path $InstallRoot).Path

# Build in a temporary install area. The updater waits for the old native host
# to exit before invoking this script, so the installed EXE can be replaced.
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $MainBuild,$UpdaterBuild,$PublishDir,$UpdaterPublishDir | Out-Null

Copy-Item (Join-Path $SourceRoot "Program.cs") (Join-Path $MainBuild "Program.cs") -Force
Copy-Item (Join-Path $SourceRoot "VideoFlowNative.csproj") (Join-Path $MainBuild "VideoFlowNative.csproj") -Force
Copy-Item (Join-Path $SourceRoot "Updater.cs") (Join-Path $UpdaterBuild "Program.cs") -Force
Copy-Item (Join-Path $SourceRoot "Updater.csproj") (Join-Path $UpdaterBuild "VideoFlowUpdater.csproj") -Force

Push-Location $MainBuild
try {
  dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o $PublishDir
  if($LASTEXITCODE -ne 0){throw "Native bridge publish failed."}
} finally { Pop-Location }

Push-Location $UpdaterBuild
try {
  dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o $UpdaterPublishDir
  if($LASTEXITCODE -ne 0){throw "Updater publish failed."}
} finally { Pop-Location }

Copy-Item (Join-Path $PublishDir "VideoFlowNative.exe") $Exe -Force
Copy-Item (Join-Path $UpdaterPublishDir "VideoFlowUpdater.exe") $UpdaterExe -Force

@{
  name=$HostName
  description="VideoFlow FFmpeg native bridge"
  path=$Exe
  type="stdio"
  allowed_origins=@("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $Manifest

$key="HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item $key -Force | Out-Null
Set-ItemProperty $key -Name "(default)" -Value $Manifest

$installedVersion=""
try { $installedVersion=(Get-Content (Join-Path $InstallRoot "extension\manifest.json") -Raw | ConvertFrom-Json).version } catch { $installedVersion="" }
@{
  extensionId=$ExtensionId
  installRoot=$InstallRoot
  installedVersion=$installedVersion
  installedAt=(Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $InstallDir "install-config.json")

Write-Host ""
Write-Host "SUCCESS: VideoFlow native bridge + automatic updater installed."
Write-Host "Bridge:  $Exe"
Write-Host "Updater: $UpdaterExe"
Write-Host "Root:    $InstallRoot"
