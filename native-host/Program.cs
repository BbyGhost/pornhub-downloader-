using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;

internal static class Program
{
    static readonly object LockObj = new();

    public static void Main()
    {
        try
        {
            Stream input = Console.OpenStandardInput();
            while (true)
            {
                byte[]? h = ReadExact(input,4);
                if (h == null) return;
                int len = BitConverter.ToInt32(h,0);
                if (len <= 0 || len > 16000000) return;
                byte[]? body = ReadExact(input,len);
                if (body == null) return;

                using JsonDocument doc = JsonDocument.Parse(body);
                JsonElement root = doc.RootElement;
                string action = Get(root,"action");
                string url = Get(root,"url");
                string referer = Get(root,"referer");
                string origin = Get(root,"origin");
                string ua = Get(root,"userAgent");
                string cookie = Get(root,"cookie");
                int videoStream = -1;
                if (root.TryGetProperty("videoStream", out var vs) && vs.ValueKind == JsonValueKind.Number) videoStream = vs.GetInt32();

                if (action == "probe") Probe(url,referer,origin,ua,cookie);
                else if (action == "download") Download(url,Get(root,"filename"),referer,origin,ua,cookie,videoStream);
                else if (action == "update") { Update(); return; }
            }
        }
        catch(Exception ex) { Log(ex); Send(new {@event="error", error=ex.Message}); }
    }

    static string Get(JsonElement r,string n)=>r.TryGetProperty(n,out var v)?v.GetString()??"":"";

    static string Ffmpeg()
    {
        string local=Path.Combine(AppContext.BaseDirectory,"ffmpeg.exe");
        if(File.Exists(local)) return local;
        string winget=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Microsoft","WinGet","Links","ffmpeg.exe");
        if(File.Exists(winget)) return winget;
        return "ffmpeg.exe";
    }

    static string Ffprobe()
    {
        string local=Path.Combine(AppContext.BaseDirectory,"ffprobe.exe");
        if(File.Exists(local)) return local;
        string winget=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Microsoft","WinGet","Links","ffprobe.exe");
        if(File.Exists(winget)) return winget;
        return "ffprobe.exe";
    }

    static void AddNetworkFamily(ProcessStartInfo psi,string url)
    {
        try
        {
            var u=new Uri(url);
            var q=System.Web.HttpUtility.ParseQueryString(u.Query);
            string ip=q["ip"]??"";
            if(ip.Contains(":")) { psi.ArgumentList.Add("-6"); }
            else if(System.Net.IPAddress.TryParse(ip,out var addr) && addr.AddressFamily==System.Net.Sockets.AddressFamily.InterNetwork)
            { psi.ArgumentList.Add("-4"); }
        }
        catch {}
    }

    static void AddHeaders(ProcessStartInfo psi,string referer,string origin,string ua,string cookie)
    {
        if(!string.IsNullOrWhiteSpace(ua)){psi.ArgumentList.Add("-user_agent");psi.ArgumentList.Add(ua);}
        if(!string.IsNullOrWhiteSpace(referer)){psi.ArgumentList.Add("-referer");psi.ArgumentList.Add(referer);}
        if(!string.IsNullOrWhiteSpace(origin)){psi.ArgumentList.Add("-headers");psi.ArgumentList.Add("Origin: "+origin+"\r\n");}
        if(!string.IsNullOrWhiteSpace(cookie)){psi.ArgumentList.Add("-headers");psi.ArgumentList.Add("Cookie: "+cookie+"\r\n");}
        psi.ArgumentList.Add("-rw_timeout");psi.ArgumentList.Add("60000000");
        psi.ArgumentList.Add("-reconnect");psi.ArgumentList.Add("1");
        psi.ArgumentList.Add("-reconnect_streamed");psi.ArgumentList.Add("1");
        psi.ArgumentList.Add("-reconnect_at_eof");psi.ArgumentList.Add("1");
        psi.ArgumentList.Add("-reconnect_on_network_error");psi.ArgumentList.Add("1");
        psi.ArgumentList.Add("-reconnect_delay_max");psi.ArgumentList.Add("10");
    }

    static void Probe(string url,string referer,string origin,string ua,string cookie)
    {
        try
        {
            var psi=new ProcessStartInfo{FileName=Ffprobe(),UseShellExecute=false,RedirectStandardError=true,RedirectStandardOutput=true,CreateNoWindow=true};
            psi.ArgumentList.Add("-v");psi.ArgumentList.Add("error");
            AddNetworkFamily(psi,url);AddHeaders(psi,referer,origin,ua,cookie);
            psi.ArgumentList.Add("-show_entries");psi.ArgumentList.Add("stream=index,codec_type,width,height,r_frame_rate");
            psi.ArgumentList.Add("-of");psi.ArgumentList.Add("json");psi.ArgumentList.Add("-i");psi.ArgumentList.Add(url);

            using var p=Process.Start(psi)!;
            if(!p.WaitForExit(12000))
            {
                try{p.Kill(true);}catch{}
                Send(new {@event="probe",qualities=new List<object>()});
                return;
            }

            string output=p.StandardOutput.ReadToEnd();
            var list=new List<object>();
            try
            {
                using var json=JsonDocument.Parse(output);
                if(json.RootElement.TryGetProperty("streams",out var streams))
                {
                    foreach(var s in streams.EnumerateArray())
                    {
                        if(!s.TryGetProperty("codec_type",out var ct) || ct.GetString()!="video") continue;
                        int width=s.TryGetProperty("width",out var w)&&w.TryGetInt32(out var wi)?wi:0;
                        int height=s.TryGetProperty("height",out var h)&&h.TryGetInt32(out var he)?he:0;
                        int index=s.TryGetProperty("index",out var ix)&&ix.TryGetInt32(out var ii)?ii:0;
                        string fps=s.TryGetProperty("r_frame_rate",out var fr)?fr.GetString()??"":"";
                        if(width>0 && height>0) list.Add(new {height,width,fps,streamIndex=index});
                    }
                }
            }
            catch {}

            Send(new {@event="probe",qualities=list});
        }
        catch(Exception ex){Send(new {@event="probe",qualities=new List<object>()});}
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
                Send(new {@event="error",error="VideoFlow installation folder was not found."});
                return;
            }
            string updater = Path.Combine(AppContext.BaseDirectory, "VideoFlowUpdater.exe");
            if (!File.Exists(updater))
            {
                Send(new {@event="error",error="VideoFlow updater is not installed. Run install.ps1 once to install it."});
                return;
            }
            var psi = new ProcessStartInfo
            {
                FileName = updater,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add(root);
            psi.ArgumentList.Add(Environment.ProcessId.ToString());
            psi.ArgumentList.Add(id);
            Process.Start(psi);
            Send(new {@event="update_started"});
        }
        catch(Exception ex) { Log(ex); Send(new {@event="error",error=ex.Message}); }
    }

    static void Download(string url,string filename,string referer,string origin,string ua,string cookie,int videoStream)
    {
        try
        {
            string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads","VideoFlow");
            Directory.CreateDirectory(folder); string safe=Safe(filename); if(!safe.EndsWith(".mp4",StringComparison.OrdinalIgnoreCase))safe+=".mp4";
            string output=Path.Combine(folder,safe); int n=1; while(File.Exists(output))output=Path.Combine(folder,$"{Path.GetFileNameWithoutExtension(safe)} ({n++}).mp4");
            string temp=output+".part.mp4"; try { if(File.Exists(temp)) File.Delete(temp); } catch {}
            var psi=new ProcessStartInfo{FileName=Ffmpeg(),UseShellExecute=false,RedirectStandardError=true,RedirectStandardOutput=true,CreateNoWindow=true};
            psi.ArgumentList.Add("-hide_banner");AddNetworkFamily(psi,url);psi.ArgumentList.Add("-y");AddHeaders(psi,referer,origin,ua,cookie);psi.ArgumentList.Add("-i");psi.ArgumentList.Add(url);psi.ArgumentList.Add("-map");psi.ArgumentList.Add(videoStream >= 0 ? $"0:{videoStream}" : "0:v:0?");psi.ArgumentList.Add("-map");psi.ArgumentList.Add("0:a:0?");psi.ArgumentList.Add("-c");psi.ArgumentList.Add("copy");psi.ArgumentList.Add("-movflags");psi.ArgumentList.Add("+faststart");psi.ArgumentList.Add("-f");psi.ArgumentList.Add("mp4");psi.ArgumentList.Add(temp);
            using var p=Process.Start(psi)!; double duration=0; string last="";
            while(!p.StandardError.EndOfStream){string line=p.StandardError.ReadLine()??"";last=line;int di=line.IndexOf("Duration:",StringComparison.OrdinalIgnoreCase);if(di>=0)duration=Parse(line.Substring(di+9).Split(',')[0].Trim());int ti=line.IndexOf("time=",StringComparison.OrdinalIgnoreCase);if(ti>=0){double cur=Parse(line.Substring(ti+5).Split(' ')[0].Trim());double pct=duration>0?Math.Min(99,cur/duration*100):0;string speed="";int si=line.IndexOf("speed=",StringComparison.OrdinalIgnoreCase);if(si>=0)speed=line.Substring(si+6).Split(' ')[0].Trim();Send(new {@event="progress",progress=pct,speed});}}
            p.WaitForExit(); if(p.ExitCode!=0)
            {
                try { if(File.Exists(temp)) File.Delete(temp); } catch {}
                string detail=last;
                if(detail.Contains("-138",StringComparison.OrdinalIgnoreCase) || detail.Contains("timed out",StringComparison.OrdinalIgnoreCase))
                    detail="Connection to the video server timed out. The site may require a fresh session or the CDN may be temporarily unavailable.";
                throw new Exception("FFmpeg failed: "+detail);
            } if(!File.Exists(temp)||new FileInfo(temp).Length==0)throw new Exception("Output file was not created.");
            if(File.Exists(output)) File.Delete(output);
            File.Move(temp,output);
            Send(new {@event="complete",path=output,progress=100});
        }
        catch(Exception ex){Log(ex);Send(new {@event="error",error=ex.Message});}
    }

    static string Safe(string s){if(string.IsNullOrWhiteSpace(s))return"video";foreach(char c in Path.GetInvalidFileNameChars())s=s.Replace(c,' ');s=s.Trim().TrimEnd('.',' ');if(string.IsNullOrWhiteSpace(s))return"video";string u=s.Trim().TrimEnd('.',' ').ToUpperInvariant();string[] reserved={"CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"};if(Array.Exists(reserved,x=>x==u||u.StartsWith(x+".")))s="_"+s;return s;}
    static double Parse(string s)=>TimeSpan.TryParse(s,out var t)?t.TotalSeconds:0;
    static byte[]? ReadExact(Stream s,int n){byte[] b=new byte[n];int o=0;while(o<n){int g=s.Read(b,o,n-o);if(g<=0)return null;o+=g;}return b;}
    static void Send(object o){byte[] b=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o));lock(LockObj){var s=Console.OpenStandardOutput();s.Write(BitConverter.GetBytes(b.Length),0,4);s.Write(b,0,b.Length);s.Flush();}}
    static void Log(Exception ex){try{string d=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"VideoFlowNative");Directory.CreateDirectory(d);File.WriteAllText(Path.Combine(d,"native_host_error.txt"),DateTime.Now+"\r\n"+ex);}catch{}}
}
