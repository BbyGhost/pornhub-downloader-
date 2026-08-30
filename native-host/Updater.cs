using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;

internal static class Program
{
    const string UpdateManifestUrl = "https://raw.githubusercontent.com/BbyGhost/pornhub-downloader-/main/update.json";
    const string PackageUrl = "https://github.com/BbyGhost/pornhub-downloader-/archive/refs/heads/main.zip";

    static async Task<int> Main(string[] args)
    {
        if (args.Length < 1) return 2;
        string root = Path.GetFullPath(args[0]);
        int parentPid = args.Length > 1 && int.TryParse(args[1], out var p) ? p : 0;
        string extensionId = args.Length > 2 ? args[2] : "";

        string backupPath = "";
        try
        {
            if (parentPid > 0) {
                try { using var parent = System.Diagnostics.Process.GetProcessById(parentPid); await parent.WaitForExitAsync(); }
                catch {}
                await Task.Delay(1200);
            }

            string ext = Path.Combine(root, "extension");
            string manifestPath = Path.Combine(ext, "manifest.json");
            if (!File.Exists(manifestPath)) throw new Exception("VideoFlow extension folder was not found.");

            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("VideoFlow-Updater/1.0");

            WriteStatus(root, true, "Checking for update…", "", "");
            var remote = JsonSerializer.Deserialize<UpdateInfo>(await http.GetStringAsync(UpdateManifestUrl))
                ?? throw new Exception("Invalid update manifest.");
            var local = JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(manifestPath))
                ?? throw new Exception("Invalid local extension manifest.");

            WriteStatus(root, true, "Downloading update…", local.version, remote.version);
            if (!Newer(remote.version, local.version))
            {
                WriteStatus(root, true, "Already up to date.", local.version, local.version);
                return 0;
            }

            if (string.IsNullOrWhiteSpace(extensionId))
            {
                string cfg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VideoFlowNative", "install-config.json");
                if (File.Exists(cfg))
                {
                    var c = JsonSerializer.Deserialize<InstallConfig>(await File.ReadAllTextAsync(cfg));
                    extensionId = c?.extensionId ?? "";
                }
            }

            WriteStatus(root, true, "Installing update…", local.version, remote.version);
            string tmp = Path.Combine(Path.GetTempPath(), "VideoFlowUpdate-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            try
            {
                string zip = Path.Combine(tmp, "update.zip");
                await File.WriteAllBytesAsync(zip, await http.GetByteArrayAsync(PackageUrl));
                ZipFile.ExtractToDirectory(zip, tmp);
                string? top = Directory.GetDirectories(tmp).FirstOrDefault(d => Directory.Exists(Path.Combine(d, "extension")));
                if (top == null) throw new Exception("GitHub package is missing the extension folder.");

                string backup = root.TrimEnd(Path.DirectorySeparatorChar) + ".backup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                backupPath = Path.Combine(backup, "extension");
                Directory.CreateDirectory(backup);
                Directory.Move(ext, backupPath);

                try
                {
                    CopyDirectory(Path.Combine(top, "extension"), ext);
                }
                catch
                {
                    if (Directory.Exists(ext)) Directory.Delete(ext, true);
                    Directory.Move(backupPath, ext);
                    throw;
                }

                string install = Path.Combine(top, "native-host", "install.ps1");
                if (File.Exists(install) && !string.IsNullOrWhiteSpace(extensionId))
                {
                    var psi = new System.Diagnostics.ProcessStartInfo("powershell.exe")
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WorkingDirectory = Path.GetDirectoryName(install)!
                    };
                    psi.ArgumentList.Add("-NoProfile");
                    psi.ArgumentList.Add("-ExecutionPolicy"); psi.ArgumentList.Add("Bypass");
                    psi.ArgumentList.Add("-File"); psi.ArgumentList.Add(install);
                    psi.ArgumentList.Add("-ExtensionId"); psi.ArgumentList.Add(extensionId);
                    psi.ArgumentList.Add("-InstallRoot"); psi.ArgumentList.Add(root);
                    psi.ArgumentList.Add("-AutoUpdate");

                    using var installer = System.Diagnostics.Process.Start(psi)
                        ?? throw new Exception("Could not start the native bridge installer.");
                    await installer.WaitForExitAsync();
                    if (installer.ExitCode != 0)
                        throw new Exception("Native bridge update failed. Code: " + installer.ExitCode);
                }

                    // Validate the new extension before removing the previous-version backup.
                string newManifestPath = Path.Combine(root, "extension", "manifest.json");
                if (!File.Exists(newManifestPath))
                    throw new Exception("Update verification failed: manifest.json is missing.");
                var installed = JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(newManifestPath));
                if (installed == null || !string.Equals(installed.version, remote.version, StringComparison.OrdinalIgnoreCase))
                    throw new Exception($"Update verification failed: expected {remote.version}, found {installed?.version ?? "unknown"}.");

                // The new version is valid. Keep ONE rollback backup and remove older backups.
                CleanupOldBackups(root, backupPath);
                WriteStatus(root, true, "Updated successfully. Old files cleaned.", local.version, remote.version);
                ScheduleSelfDelete();
                return 0;
            }
            finally
            {
                try { Directory.Delete(tmp, true); } catch {}
            }
        }
        catch (Exception ex)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(backupPath) && Directory.Exists(backupPath))
                {
                    string ext = Path.Combine(root, "extension");
                    if (Directory.Exists(ext)) Directory.Delete(ext, true);
                    Directory.Move(backupPath, ext);
                }
            }
            catch {}
            WriteStatus(root, false, ex.Message, "", "");
            ScheduleSelfDelete();
            return 1;
        }
    }

    static void ScheduleSelfDelete()
    {
        try
        {
            string exe = Environment.ProcessPath ?? "";
            if (string.IsNullOrWhiteSpace(exe)) return;
            var psi = new System.Diagnostics.ProcessStartInfo("cmd.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/c");
            psi.ArgumentList.Add($"ping 127.0.0.1 -n 3 >nul & del /f /q \"{exe}\"");
            System.Diagnostics.Process.Start(psi);
        }
        catch {}
    }

    static bool Newer(string a, string b)
    {
        if (Version.TryParse(a.TrimStart('v','V'), out var av) &&
            Version.TryParse(b.TrimStart('v','V'), out var bv))
            return av > bv;
        return !string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    static void CleanupOldBackups(string root, string currentBackupPath)
    {
        try
        {
            string parent = Directory.GetParent(root)?.FullName ?? "";
            string name = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrWhiteSpace(parent) || string.IsNullOrWhiteSpace(name)) return;

            var backups = Directory.GetDirectories(parent, name + ".backup-*")
                .OrderByDescending(Directory.GetCreationTimeUtc)
                .ToList();

            bool keptCurrent = false;
            foreach (var dir in backups)
            {
                bool isCurrent = !string.IsNullOrWhiteSpace(currentBackupPath) &&
                                  Path.GetFullPath(dir).Equals(
                                      Path.GetFullPath(Directory.GetParent(currentBackupPath)?.FullName ?? ""),
                                      StringComparison.OrdinalIgnoreCase);

                if (!keptCurrent && isCurrent)
                {
                    keptCurrent = true;
                    continue;
                }

                // Keep the newest backup if the current backup path could not be identified.
                if (!keptCurrent && dir == backups.First())
                {
                    keptCurrent = true;
                    continue;
                }

                try { Directory.Delete(dir, true); } catch {}
            }
        }
        catch {}
    }

    static void CopyDirectory(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var file in Directory.GetFiles(src))
            File.Copy(file, Path.Combine(dst, Path.GetFileName(file)), true);
        foreach (var dir in Directory.GetDirectories(src))
            CopyDirectory(dir, Path.Combine(dst, Path.GetFileName(dir)));
    }

    static void WriteStatus(string root, bool ok, string message, string from, string to)
    {
        try
        {
            File.WriteAllText(Path.Combine(root, ".videoflow-update.json"),
                JsonSerializer.Serialize(new { ok, message, fromVersion = from, toVersion = to, at = DateTimeOffset.Now }));
        }
        catch {}
    }

    sealed class UpdateInfo { public string version { get; set; } = ""; }
    sealed class Manifest { public string version { get; set; } = ""; }
    sealed class InstallConfig { public string extensionId { get; set; } = ""; }
}
