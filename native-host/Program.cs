using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

internal static class Program
{
    static readonly object LockObj = new();
    static readonly Stream Input = Console.OpenStandardInput();
    static readonly Stream Output = Console.OpenStandardOutput();

    public static void Main()
    {
        try
        {
            while (true)
            {
                byte[]? h = ReadExact(Input, 4);
                if (h == null) return;
                int len = BitConverter.ToInt32(h, 0);
                if (len <= 0 || len > 16000000) return;
                byte[]? body = ReadExact(Input, len);
                if (body == null) return;

                using JsonDocument doc = JsonDocument.Parse(body);
                JsonElement root = doc.RootElement;
                string action = Get(root, "action");
                string url = Get(root, "url");
                string referer = Get(root, "referer");
                string origin = Get(root, "origin");
                string ua = Get(root, "userAgent");
                string cookie = Get(root, "cookie");
                int videoStream = -1;
                if (root.TryGetProperty("videoStream", out var vs) && vs.ValueKind == JsonValueKind.Number)
                    videoStream = vs.GetInt32();

                if (action == "probe") Probe(url, referer, origin, ua, cookie);
                else if (action == "download") Download(url, Get(root, "filename"), referer, origin, ua, cookie, videoStream);
                else if (action == "update") { Update(); return; }
                else if (action == "update-status") Status();
                else Send(new { @event = "error", error = "Unknown native action: " + action });
            }
        }
        catch (Exception ex)
        {
            Log(ex);
            Send(new { @event = "error", error = ex.Message });
        }
    }

    static string Get(JsonElement r, string n) => r.TryGetProperty(n, out var v) ? v.GetString() ?? "" : "";

    static string Ffmpeg()
    {
        string local = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
        if (File.Exists(local)) return local;
        string winget = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WinGet", "Links", "ffmpeg.exe");
        if (File.Exists(winget)) return winget;
        return "ffmpeg.exe";
    }

    static string Ffprobe()
    {
        string local = Path.Combine(AppContext.BaseDirectory, "ffprobe.exe");
        if (File.Exists(local)) return local;
        string winget = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WinGet", "Links", "ffprobe.exe");
        if (File.Exists(winget)) return winget;
        return "ffprobe.exe";
    }

    // FFmpeg accepts a single HTTP header block. Combining headers avoids
    // later -headers arguments replacing earlier ones on some builds.
    static void AddHeaders(ProcessStartInfo psi, string referer, string origin, string ua, string cookie, bool includeCookie)
    {
        if (!string.IsNullOrWhiteSpace(ua))
        {
            psi.ArgumentList.Add("-user_agent");
            psi.ArgumentList.Add(ua);
        }
        if (!string.IsNullOrWhiteSpace(referer))
        {
            psi.ArgumentList.Add("-referer");
            psi.ArgumentList.Add(referer);
        }

        var headers = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(origin)) headers.Append("Origin: ").Append(origin).Append("\r\n");
        if (includeCookie && !string.IsNullOrWhiteSpace(cookie)) headers.Append("Cookie: ").Append(cookie).Append("\r\n");
        if (headers.Length > 0)
        {
            psi.ArgumentList.Add("-headers");
            psi.ArgumentList.Add(headers.ToString());
        }
    }

    static void AddTimeout(ProcessStartInfo psi, long microseconds)
    {
        psi.ArgumentList.Add("-rw_timeout");
        psi.ArgumentList.Add(microseconds.ToString());
    }

    static void Probe(string url, string referer, string origin, string ua, string cookie)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = Ffprobe(),
                UseShellExecute = false,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("-v"); psi.ArgumentList.Add("error");
            AddHeaders(psi, referer, origin, ua, cookie, true);
            AddTimeout(psi, 30000000);
            psi.ArgumentList.Add("-show_entries");
            psi.ArgumentList.Add("stream=index,codec_type,codec_name,width,height,r_frame_rate,bit_rate");
            psi.ArgumentList.Add("-of"); psi.ArgumentList.Add("json");
            psi.ArgumentList.Add("-i"); psi.ArgumentList.Add(url);

            using var p = Process.Start(psi)!;
            if (!p.WaitForExit(15000))
            {
                try { p.Kill(true); } catch { }
                Send(new { @event = "probe", qualities = new List<object>(), error = "Probe timed out." });
                return;
            }

            string output = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            var list = new List<object>();
            try
            {
                using var json = JsonDocument.Parse(output);
                if (json.RootElement.TryGetProperty("streams", out var streams))
                {
                    foreach (var s in streams.EnumerateArray())
                    {
                        if (!s.TryGetProperty("codec_type", out var ct) || ct.GetString() != "video") continue;
                        int width = s.TryGetProperty("width", out var w) && w.TryGetInt32(out var wi) ? wi : 0;
                        int height = s.TryGetProperty("height", out var h) && h.TryGetInt32(out var he) ? he : 0;
                        int index = s.TryGetProperty("index", out var ix) && ix.TryGetInt32(out var ii) ? ii : 0;
                        string fps = s.TryGetProperty("r_frame_rate", out var fr) ? fr.GetString() ?? "" : "";
                        string codec = s.TryGetProperty("codec_name", out var cn) ? cn.GetString() ?? "" : "";
                        long bitrate = s.TryGetProperty("bit_rate", out var br) && br.TryGetInt64(out var bi) ? bi : 0;
                        if (width > 0 && height > 0)
                            list.Add(new { height, width, fps, codec, bitrate, streamIndex = index });
                    }
                }
            }
            catch { }

            Send(new { @event = "probe", qualities = list, error = list.Count == 0 && !string.IsNullOrWhiteSpace(stderr) ? TrimDiagnostic(stderr) : "" });
        }
        catch (Exception ex)
        {
            Send(new { @event = "probe", qualities = new List<object>(), error = ex.Message });
        }
    }

    static void Status()
    {
        try
        {
            string root = "";
            string cfg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VideoFlowNative", "install-config.json");
            if (File.Exists(cfg))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(cfg));
                root = doc.RootElement.TryGetProperty("installRoot", out var r) ? r.GetString() ?? "" : "";
            }
            string status = Path.Combine(root, ".videoflow-update.json");
            if (File.Exists(status))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(status));
                Send(new { @event = "update_status", status = doc.RootElement.Clone() });
            }
            else Send(new { @event = "update_status", status = new { ok = true, message = "No update running." } });
        }
        catch (Exception ex) { Send(new { @event = "error", error = ex.Message }); }
    }

    static void Update()
    {
        try
        {
            string root = "";
            string id = "";
            string cfg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VideoFlowNative", "install-config.json");
            if (File.Exists(cfg))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(cfg));
                root = doc.RootElement.TryGetProperty("installRoot", out var r) ? r.GetString() ?? "" : "";
                id = doc.RootElement.TryGetProperty("extensionId", out var i) ? i.GetString() ?? "" : "";
            }
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(Path.Combine(root, "extension")))
            {
                Send(new { @event = "error", error = "VideoFlow installation folder was not found." });
                return;
            }
            string updater = Path.Combine(AppContext.BaseDirectory, "VideoFlowUpdater.exe");
            if (!File.Exists(updater))
            {
                Send(new { @event = "error", error = "VideoFlow updater is not installed. Run install.ps1 once to install it." });
                return;
            }

            // Clear any stale completion/error state before launching a new updater.
            // This lets the popup show the real current update stage immediately.
            try
            {
                File.WriteAllText(
                    Path.Combine(root, ".videoflow-update.json"),
                    JsonSerializer.Serialize(new { ok = true, message = "Starting updater…", fromVersion = "", toVersion = "", at = DateTimeOffset.Now })
                );
            }
            catch { }

            string tempUpdater = Path.Combine(Path.GetTempPath(), "VideoFlowUpdater-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(updater, tempUpdater, true);
            var psi = new ProcessStartInfo { FileName = tempUpdater, UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add(root);
            psi.ArgumentList.Add(Environment.ProcessId.ToString());
            psi.ArgumentList.Add(id);
            Process.Start(psi);
            Send(new { @event = "update_started" });
        }
        catch (Exception ex) { Log(ex); Send(new { @event = "error", error = ex.Message }); }
    }

    static bool LooksLikePlaylist(string url)
    {
        string u = (url ?? "").ToLowerInvariant();
        return u.Contains(".m3u8") || u.Contains(".mpd") || u.Contains("manifest") || u.Contains("playlist");
    }

    static async Task<(bool ok, long bytes, string error)> TryParallelDirectDownload(string url, string output, string referer, string origin, string ua, string cookie)
    {
        // Direct progressive files can be much faster when the server supports byte ranges.
        // HLS/DASH playlists stay on FFmpeg because they require segment/manifest handling.
        if (LooksLikePlaylist(url)) return (false, 0, "playlist");

        try
        {
            using var client = new HttpClient(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.None })
            {
                Timeout = TimeSpan.FromMinutes(20)
            };
            client.DefaultRequestHeaders.UserAgent.ParseAdd(string.IsNullOrWhiteSpace(ua) ? "Mozilla/5.0" : ua);
            if (!string.IsNullOrWhiteSpace(referer)) client.DefaultRequestHeaders.Referrer = new Uri(referer);
            if (!string.IsNullOrWhiteSpace(origin)) client.DefaultRequestHeaders.TryAddWithoutValidation("Origin", origin);
            if (!string.IsNullOrWhiteSpace(cookie)) client.DefaultRequestHeaders.TryAddWithoutValidation("Cookie", cookie);

            using var firstReq = new HttpRequestMessage(HttpMethod.Get, url);
            firstReq.Headers.Range = new RangeHeaderValue(0, 0);
            using var first = await client.SendAsync(firstReq, HttpCompletionOption.ResponseHeadersRead);
            if (first.StatusCode != HttpStatusCode.PartialContent || first.Content.Headers.ContentRange?.Length is not long total || total <= 1024 * 1024)
                return (false, 0, "server does not expose a usable byte range");

            string ct = first.Content.Headers.ContentType?.MediaType ?? "";
            if (!string.IsNullOrWhiteSpace(ct) && !ct.StartsWith("video/", StringComparison.OrdinalIgnoreCase) &&
                !ct.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase))
                return (false, 0, "source is not a direct video object");

            int workers = total >= 512L * 1024 * 1024 ? 8 : total >= 128L * 1024 * 1024 ? 6 : 4;
            long chunk = Math.Max(4L * 1024 * 1024, (total + workers - 1) / workers);
            string dir = output + ".vfparts";
            Directory.CreateDirectory(dir);
            var tasks = new List<Task>();
            var errors = new List<Exception>();
            long completed = 0;
            object progressLock = new();

            for (int i = 0; i < workers; i++)
            {
                long start = i * chunk;
                if (start >= total) break;
                long end = Math.Min(total - 1, start + chunk - 1);
                int partIndex = i;
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        string part = Path.Combine(dir, partIndex.ToString("D3") + ".part");
                        using var req = new HttpRequestMessage(HttpMethod.Get, url);
                        req.Headers.Range = new RangeHeaderValue(start, end);
                        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                        resp.EnsureSuccessStatusCode();
                        if (resp.Content.Headers.ContentRange?.From != start || resp.Content.Headers.ContentRange?.To != end)
                            throw new IOException("Server returned an unexpected byte range.");
                        await using var input = await resp.Content.ReadAsStreamAsync();
                        await using var outputStream = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, useAsync: true);
                        byte[] buffer = new byte[1024 * 1024];
                        int read;
                        long local = 0;
                        while ((read = await input.ReadAsync(buffer, 0, buffer.Length)) > 0)
                        {
                            await outputStream.WriteAsync(buffer, 0, read);
                            local += read;
                            lock (progressLock)
                            {
                                completed += read;
                                double pct = Math.Min(99, completed * 100.0 / total);
                                Send(new { @event = "progress", progress = pct, speed = "parallel" });
                            }
                        }
                        if (local != end - start + 1) throw new IOException("A ranged segment was incomplete.");
                    }
                    catch (Exception ex)
                    {
                        lock (errors) errors.Add(ex);
                    }
                }));
            }

            await Task.WhenAll(tasks);
            if (errors.Count > 0) return (false, 0, errors[0].Message);

            string temp = output + ".parallel.part";
            try
            {
                if (File.Exists(temp)) File.Delete(temp);
                await using var combined = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024, useAsync: true);
                for (int i = 0; i < workers; i++)
                {
                    string part = Path.Combine(dir, i.ToString("D3") + ".part");
                    if (!File.Exists(part)) throw new IOException("Missing ranged segment.");
                    await using var input = new FileStream(part, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, useAsync: true);
                    await input.CopyToAsync(combined, 1024 * 1024);
                }
                await combined.FlushAsync();
                if (new FileInfo(temp).Length != total) throw new IOException("Combined file size does not match the source.");
                if (File.Exists(output)) File.Delete(output);
                File.Move(temp, output);
                Send(new { @event = "progress", progress = 100, speed = "parallel" });
                return (true, total, "");
            }
            finally
            {
                try { if (File.Exists(temp)) File.Delete(temp); } catch { }
                try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
            }
        }
        catch (Exception ex)
        {
            try { if (Directory.Exists(output + ".vfparts")) Directory.Delete(output + ".vfparts", true); } catch { }
            return (false, 0, ex.Message);
        }
    }

    static void Download(string url, string filename, string referer, string origin, string ua, string cookie, int videoStream)
    {
        try
        {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "VideoFlow");
            Directory.CreateDirectory(folder);
            string safe = Safe(filename);
            if (!safe.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase)) safe += ".mp4";
            string output = Path.Combine(folder, safe);
            int n = 1;
            while (File.Exists(output)) output = Path.Combine(folder, $"{Path.GetFileNameWithoutExtension(safe)} ({n++}).mp4");
            string temp = output + ".part.mp4";
            // Fast path for progressive MP4/WebM sources: use multiple HTTP range requests
            // when the server supports them. This leaves HLS/DASH and non-range servers to FFmpeg.
            try
            {
                var fast = TryParallelDirectDownload(url, output, referer, origin, ua, cookie).GetAwaiter().GetResult();
                if (fast.ok)
                {
                    var validation = ValidateOutput(output);
                    if (validation.ok)
                    {
                        Send(new { @event = "complete", path = output, progress = 100, recovered = false, bytes = fast.bytes, duration = validation.duration, mode = "parallel-range" });
                        return;
                    }
                    try { if (File.Exists(output)) File.Delete(output); } catch { }
                }
            }
            catch { }

            Exception? lastError = null;
            for (int attempt = 0; attempt < 4; attempt++)
            {
                try { if (File.Exists(temp)) File.Delete(temp); } catch { }
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = Ffmpeg(), UseShellExecute = false,
                        RedirectStandardError = true, RedirectStandardOutput = true, CreateNoWindow = true
                    };
                    psi.ArgumentList.Add("-hide_banner");
                    psi.ArgumentList.Add("-y");

                    if (attempt == 0)
                    {
                        // Minimal profile: avoids optional HTTP flags entirely.
                    }
                    else if (attempt == 1)
                    {
                        AddHeaders(psi, referer, "", ua, "", false);
                    }
                    else if (attempt == 2)
                    {
                        AddHeaders(psi, referer, origin, ua, "", false);
                        AddTimeout(psi, 120000000);
                    }
                    else
                    {
                        AddHeaders(psi, referer, origin, ua, cookie, true);
                        AddTimeout(psi, 600000000);
                    }

                    psi.ArgumentList.Add("-i"); psi.ArgumentList.Add(url);
                    if (videoStream >= 0)
                    {
                        psi.ArgumentList.Add("-map"); psi.ArgumentList.Add($"0:{videoStream}");
                    }
                    else
                    {
                        psi.ArgumentList.Add("-map"); psi.ArgumentList.Add("0:v:0?");
                    }
                    psi.ArgumentList.Add("-map"); psi.ArgumentList.Add("0:a:0?");
                    psi.ArgumentList.Add("-sn");
                    psi.ArgumentList.Add("-dn");
                    psi.ArgumentList.Add("-c"); psi.ArgumentList.Add("copy");
                    psi.ArgumentList.Add("-movflags"); psi.ArgumentList.Add("+faststart");
                    psi.ArgumentList.Add("-max_interleave_delta"); psi.ArgumentList.Add("0");
                    psi.ArgumentList.Add("-f"); psi.ArgumentList.Add("mp4");
                    psi.ArgumentList.Add(temp);

                    using var p = Process.Start(psi)!;
                    double duration = 0;
                    var diagnostics = new StringBuilder();
                    while (!p.StandardError.EndOfStream)
                    {
                        string line = p.StandardError.ReadLine() ?? "";
                        if (!string.IsNullOrWhiteSpace(line))
                        {
                            diagnostics.AppendLine(line);
                            if (diagnostics.Length > 12000) diagnostics.Remove(0, diagnostics.Length - 12000);
                        }
                        int di = line.IndexOf("Duration:", StringComparison.OrdinalIgnoreCase);
                        if (di >= 0) duration = Parse(line.Substring(di + 9).Split(',')[0].Trim());
                        int ti = line.IndexOf("time=", StringComparison.OrdinalIgnoreCase);
                        if (ti >= 0)
                        {
                            double cur = Parse(line.Substring(ti + 5).Split(' ')[0].Trim());
                            double pct = duration > 0 ? Math.Min(99, cur / duration * 100) : 0;
                            string speed = "";
                            int si = line.IndexOf("speed=", StringComparison.OrdinalIgnoreCase);
                            if (si >= 0) speed = line.Substring(si + 6).Split(' ')[0].Trim();
                            Send(new { @event = "progress", progress = pct, speed, attempt = attempt + 1 });
                        }
                    }
                    p.WaitForExit();
                    if (p.ExitCode == 0 && File.Exists(temp) && new FileInfo(temp).Length > 65536)
                    {
                        // A successful FFmpeg exit is not enough: some servers can return
                        // a tiny HTML/error response or a truncated media object. Validate
                        // the finished MP4 before exposing it as a completed download.
                        var validation = ValidateOutput(temp);
                        if (validation.ok)
                        {
                            if (File.Exists(output)) File.Delete(output);
                            File.Move(temp, output);
                            Send(new { @event = "complete", path = output, progress = 100, recovered = attempt > 0, bytes = new FileInfo(output).Length, duration = validation.duration });
                            return;
                        }
                        lastError = new Exception("Downloaded file failed media validation: " + validation.error);
                        Send(new { @event = "recovery", attempt = attempt + 1, message = "Downloaded data was incomplete or invalid; retrying…" });
                        continue;
                    }

                    string detail = diagnostics.ToString().Trim();
                    string unrecognized = ExtractUnrecognizedOption(detail);
                    string shown = string.IsNullOrWhiteSpace(unrecognized) ? detail : $"FFmpeg rejected option {unrecognized}.\r\n{detail}";
                    if (shown.Length > 6000) shown = shown.Substring(Math.Max(0, shown.Length - 6000));
                    lastError = new Exception("FFmpeg failed:\r\n" + shown);
                    if (!IsRecoverableFfmpegError(detail)) break;
                    Send(new { @event = "recovery", attempt = attempt + 1, message = $"FFmpeg recovery attempt {attempt + 1}/4…" });
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    if (!IsRecoverableFfmpegError(ex.Message)) break;
                    Send(new { @event = "recovery", attempt = attempt + 1, message = "Retrying with safer FFmpeg options…" });
                }
            }

            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
            throw lastError ?? new Exception("Download failed.");
        }
        catch (Exception ex) { Log(ex); Send(new { @event = "error", error = ex.Message }); }
    }

    static (bool ok, double duration, string error) ValidateOutput(string path)
    {
        try
        {
            long size = new FileInfo(path).Length;
            if (size <= 65536) return (false, 0, "Downloaded file is unexpectedly small.");

            var psi = new ProcessStartInfo
            {
                FileName = Ffprobe(),
                UseShellExecute = false,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("-v"); psi.ArgumentList.Add("error");
            psi.ArgumentList.Add("-show_entries"); psi.ArgumentList.Add("format=duration,size");
            psi.ArgumentList.Add("-of"); psi.ArgumentList.Add("default=noprint_wrappers=1:nokey=0");
            psi.ArgumentList.Add(path);
            using var p = Process.Start(psi)!;
            if (!p.WaitForExit(10000))
            {
                try { p.Kill(true); } catch {}
                return (false, 0, "Downloaded file could not be validated in time.");
            }
            string text = p.StandardOutput.ReadToEnd();
            if (p.ExitCode != 0) return (false, 0, "FFprobe could not read the completed MP4.");
            double duration = 0;
            foreach (var line in text.Split(new[] { '\r','\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (line.StartsWith("duration=", StringComparison.OrdinalIgnoreCase))
                    double.TryParse(line.Substring(9), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duration);
            }
            if (duration <= 0) return (false, 0, "Completed file has no valid duration.");
            return (true, duration, "");
        }
        catch (Exception ex) { return (false, 0, ex.Message); }
    }

    static string ExtractUnrecognizedOption(string text)
    {
        int p = text.LastIndexOf("Unrecognized option", StringComparison.OrdinalIgnoreCase);
        if (p < 0) p = text.LastIndexOf("Unknown option", StringComparison.OrdinalIgnoreCase);
        if (p < 0) return "";
        string tail = text.Substring(p);
        int q = tail.IndexOf("'");
        if (q >= 0)
        {
            int q2 = tail.IndexOf("'", q + 1);
            if (q2 > q) return tail.Substring(q, q2 - q + 1);
        }
        return "";
    }

    static bool IsRecoverableFfmpegError(string message)
    {
        string m = message.ToLowerInvariant();
        return m.Contains("option not found") || m.Contains("unrecognized option") ||
               m.Contains("error number -138") || m.Contains("timed out") ||
               m.Contains("unknown option") || m.Contains("error splitting the argument list") ||
               m.Contains("invalid argument");
    }

    static string TrimDiagnostic(string s)
    {
        s = s.Trim();
        return s.Length <= 1200 ? s : s.Substring(s.Length - 1200);
    }

    static string Safe(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "video";
        foreach (char c in Path.GetInvalidFileNameChars()) s = s.Replace(c, ' ');
        s = s.Trim().TrimEnd('.', ' ');
        if (string.IsNullOrWhiteSpace(s)) return "video";
        string u = s.ToUpperInvariant();
        string[] reserved = { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };
        if (Array.Exists(reserved, x => u == x || u.StartsWith(x + "."))) s = "_" + s;
        return s;
    }

    static double Parse(string s) => TimeSpan.TryParse(s, out var t) ? t.TotalSeconds : 0;
    static byte[]? ReadExact(Stream s, int n)
    {
        byte[] b = new byte[n]; int o = 0;
        while (o < n) { int g = s.Read(b, o, n - o); if (g <= 0) return null; o += g; }
        return b;
    }

    static void Send(object o)
    {
        byte[] b = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o));
        lock (LockObj)
        {
            Output.Write(BitConverter.GetBytes(b.Length), 0, 4);
            Output.Write(b, 0, b.Length);
            Output.Flush();
        }
    }

    static void Log(Exception ex)
    {
        try
        {
            string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VideoFlowNative");
            Directory.CreateDirectory(d);
            File.WriteAllText(Path.Combine(d, "native_host_error.txt"), DateTime.Now + "\r\n" + ex);
        }
        catch { }
    }
}
