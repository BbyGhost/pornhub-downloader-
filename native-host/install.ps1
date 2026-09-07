param(
  [string]$ExtensionId,
  [string]$InstallRoot,
  [switch]$AutoUpdate
)

$ErrorActionPreference="Stop"
$HostName="com.videoflow.fresh"
$TaskName="VideoFlow Automatic Updater"
$SourceRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir=Join-Path $env:LOCALAPPDATA "VideoFlowNative"
$MainBuild=Join-Path $InstallDir "build"
$UpdaterBuild=Join-Path $InstallDir "updater-build"
$PublishDir=Join-Path $InstallDir "publish"
$UpdaterPublishDir=Join-Path $InstallDir "updater-publish"
$Exe=Join-Path $InstallDir "VideoFlowNative.exe"
$UpdaterExe=Join-Path $InstallDir "VideoFlowUpdater.exe"
$Launcher=Join-Path $InstallDir "VideoFlowAutoUpdate.ps1"
$Manifest=Join-Path $InstallDir "$HostName.json"

Write-Host "=== VideoFlow Native Bridge + Updater ==="

$ff=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ffPath=if($ff){$ff.Source}else{Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffmpeg.exe"}
if(!(Test-Path $ffPath)){throw "FFmpeg not found."}
Write-Host "FFmpeg: $ffPath"

$fp=Get-Command ffprobe.exe -ErrorAction SilentlyContinue
$fpPath=if($fp){$fp.Source}else{Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffprobe.exe"}
if(!(Test-Path $fpPath)){Write-Warning "ffprobe.exe not found. Quality detection will use the bridge fallback."}
else{Write-Host "FFprobe: $fpPath"}

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

# Never wipe the whole install directory during an update. The updater,
# launcher and native bridge live here and must remain available.
New-Item -ItemType Directory -Force -Path $InstallDir,$MainBuild,$UpdaterBuild,$PublishDir,$UpdaterPublishDir | Out-Null

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

if(!(Test-Path (Join-Path $PublishDir "VideoFlowNative.exe"))){throw "Native bridge executable was not produced."}
if(!(Test-Path (Join-Path $UpdaterPublishDir "VideoFlowUpdater.exe"))){throw "Updater executable was not produced."}

Copy-Item (Join-Path $PublishDir "VideoFlowNative.exe") $Exe -Force
if(-not (Get-Process -Name "VideoFlowUpdater" -ErrorAction SilentlyContinue)){
  Copy-Item (Join-Path $UpdaterPublishDir "VideoFlowUpdater.exe") $UpdaterExe -Force
} else {
  Write-Host "Updater is currently running; keeping its executable until the next maintenance run."
}

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

# Persistent launcher: copies the updater to a temporary file before running it.
# This prevents Windows from locking the installed updater while the updater
# replaces the native bridge/updater during an automatic update.
$launcherContent=@'
$ErrorActionPreference="SilentlyContinue"
$installDir=Join-Path $env:LOCALAPPDATA "VideoFlowNative"
$updater=Join-Path $installDir "VideoFlowUpdater.exe"
$config=Join-Path $installDir "install-config.json"
if(!(Test-Path $updater) -or !(Test-Path $config)){exit 0}
try {
  $c=Get-Content $config -Raw | ConvertFrom-Json
  $root=[string]$c.installRoot
  $id=[string]$c.extensionId
  if([string]::IsNullOrWhiteSpace($root)){exit 0}
  $temp=Join-Path ([System.IO.Path]::GetTempPath()) ("VideoFlowUpdater-"+[guid]::NewGuid().ToString("N")+".exe")
  Copy-Item $updater $temp -Force
  $p=Start-Process -FilePath $temp -ArgumentList @($root,"0",$id) -PassThru -WindowStyle Hidden
  $p.WaitForExit()
  Start-Sleep -Seconds 2
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
} catch {}
'@
Set-Content -Path $Launcher -Value $launcherContent -Encoding UTF8 -Force

# Register a per-user Windows scheduled task. It does not require administrator
# rights and runs every 6 hours even when Chrome is closed.
try {
  $action=New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Launcher)
  $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 6) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Checks VideoFlow for verified updates every 6 hours." -Force | Out-Null
  Write-Host "Automatic updater task: enabled (every 6 hours)"
} catch {
  Write-Warning "Could not register automatic updater task: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "SUCCESS: VideoFlow native bridge + automatic updater installed."
Write-Host "Bridge:  $Exe"
Write-Host "Updater: $UpdaterExe"
Write-Host "Root:    $InstallRoot"
Write-Host "Task:    $TaskName"
