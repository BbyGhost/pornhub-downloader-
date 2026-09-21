using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;

internal static class Program
{
    private const string HostName = "com.videoflow.fresh";
    private const string InstallDirName = "VideoFlowNative";
    private static TextBox _extensionId = null!;
    private static Label _status = null!;
    private static Label _ffmpeg = null!;
    private static Button _install = null!;

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(BuildForm());
    }

    private static Form BuildForm()
    {
        var f = new Form {
            Text = "VideoFlow 8 Pro Setup",
            Width = 620, Height = 430,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = true
        };

        var title = new Label {
            Text = "VideoFlow 8 Pro",
            Font = new Font("Segoe UI", 20, FontStyle.Bold),
            AutoSize = true, Left = 28, Top = 25
        };
        var sub = new Label {
            Text = "Native engine setup & health check",
            Font = new Font("Segoe UI", 10),
            AutoSize = true, Left = 31, Top = 67
        };

        var idLabel = new Label {
            Text = "Chrome extension ID",
            AutoSize = true, Left = 30, Top = 112
        };
        _extensionId = new TextBox {
            Left = 30, Top = 137, Width = 535,
            PlaceholderText = "32-character ID from chrome://extensions"
        };

        var open = new Button {
            Text = "Open chrome://extensions",
            Left = 30, Top = 177, Width = 220, Height = 34
        };
        open.Click += (_, _) => OpenChromeExtensions();

        _install = new Button {
            Text = "Install / Repair Engine",
            Left = 345, Top = 177, Width = 220, Height = 34
        };
        _install.Click += (_, _) => InstallEngine();

        _ffmpeg = new Label {
            Text = "FFmpeg: checking...",
            AutoSize = true, Left = 30, Top = 235
        };
        _status = new Label {
            Text = "Engine: checking...",
            AutoSize = true, Left = 30, Top = 267
        };

        var info = new Label {
            Text = "This installs the Chrome Native Messaging bridge for your extension.\r\n" +
                   "VideoFlowNative.exe is a background bridge and is not meant to be double-clicked.\r\n" +
                   "The setup application is the normal double-click entry point.",
            Left = 30, Top = 315, Width = 535, Height = 60
        };

        f.Controls.AddRange(new Control[] { title, sub, idLabel, _extensionId, open, _install, _ffmpeg, _status, info });
        f.Shown += (_, _) => RefreshStatus();
        return f;
    }

    private static string InstallDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        InstallDirName);

    private static string NativeExe => Path.Combine(InstallDir, "VideoFlowNative.exe");
    private static string UpdaterExe => Path.Combine(InstallDir, "VideoFlowUpdater.exe");
    private static string ManifestPath => Path.Combine(InstallDir, HostName + ".json");

    private static void RefreshStatus()
    {
        _ffmpeg.Text = "FFmpeg: " + (FindTool("ffmpeg.exe") is not null ? "Found" : "Not found");
        var registered = Registry.CurrentUser.OpenSubKey(@"Software\Google\Chrome\NativeMessagingHosts\" + HostName)
            ?.GetValue(null)?.ToString();
        var ok = File.Exists(NativeExe) && File.Exists(UpdaterExe) &&
                 File.Exists(ManifestPath) && !string.IsNullOrWhiteSpace(registered);
        _status.Text = ok ? "Engine: Ready" : "Engine: Not installed";
    }

    private static void InstallEngine()
    {
        var id = _extensionId.Text.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-p]{32}$"))
        {
            MessageBox.Show("Enter a valid 32-character Chrome extension ID.", "VideoFlow Setup",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var sourceDir = AppContext.BaseDirectory;
        var sourceNative = Path.Combine(sourceDir, "VideoFlowNative.exe");
        var sourceUpdater = Path.Combine(sourceDir, "VideoFlowUpdater.exe");

        if (!File.Exists(sourceNative) || !File.Exists(sourceUpdater))
        {
            MessageBox.Show("The setup package is incomplete. VideoFlowNative.exe and VideoFlowUpdater.exe must be beside VideoFlowSetup.exe.",
                "VideoFlow Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            Directory.CreateDirectory(InstallDir);
            File.Copy(sourceNative, NativeExe, true);
            File.Copy(sourceUpdater, UpdaterExe, true);

            var manifest = new {
                name = HostName,
                description = "VideoFlow FFmpeg native bridge",
                path = NativeExe,
                type = "stdio",
                allowed_origins = new[] { "chrome-extension://" + id + "/" }
            };
            File.WriteAllText(ManifestPath,
                JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }),
                new System.Text.UTF8Encoding(false));

            using var key = Registry.CurrentUser.CreateSubKey(
                @"Software\Google\Chrome\NativeMessagingHosts\" + HostName);
            key!.SetValue(null, ManifestPath, RegistryValueKind.String);

            _status.Text = "Engine: Ready";
            MessageBox.Show(
                "VideoFlow Native Engine installed successfully.\r\n\r\n" +
                "Restart Chrome (or reload the extension) before testing.",
                "VideoFlow 8 Pro",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Installation failed:\r\n" + ex.Message,
                "VideoFlow Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string? FindTool(string name)
    {
        try {
            var p = new ProcessStartInfo("where.exe", name) {
                UseShellExecute = false, RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using var proc = Process.Start(p);
            proc!.WaitForExit(2000);
            if (proc.ExitCode == 0) {
                var line = proc.StandardOutput.ReadLine();
                if (!string.IsNullOrWhiteSpace(line) && File.Exists(line.Trim())) return line.Trim();
            }
        } catch { }

        var winget = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Microsoft", "WinGet", "Links", name);
        return File.Exists(winget) ? winget : null;
    }

    private static void OpenChromeExtensions()
    {
        try {
            Process.Start(new ProcessStartInfo {
                FileName = "chrome.exe",
                Arguments = "chrome://extensions/",
                UseShellExecute = true
            });
        } catch {
            Process.Start(new ProcessStartInfo {
                FileName = "https://chrome.google.com/webstore",
                UseShellExecute = true
            });
        }
    }
}