from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, subprocess, tempfile, urllib.request
from urllib.parse import urlparse

HOST='127.0.0.1'; PORT=8765; OUT=os.path.abspath('converted')
os.makedirs(OUT,exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        data=json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self): self._json(200,{'ok':True})
    def do_POST(self):
        if self.path!='/convert': return self._json(404,{'ok':False,'error':'Not found'})
        try:
            n=int(self.headers.get('Content-Length','0')); body=json.loads(self.rfile.read(n)); url=body['url']; filename=os.path.basename(body.get('filename','video.mp4'))
            if not filename.lower().endswith('.mp4'): filename += '.mp4'
            safe=''.join(c for c in filename if c.isalnum() or c in '._- ' ).strip() or 'video.mp4'
            with tempfile.TemporaryDirectory() as td:
                src=os.path.join(td,'input'); dst=os.path.join(OUT,safe)
                req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
                with urllib.request.urlopen(req,timeout=60) as r, open(src,'wb') as f:
                    while True:
                        chunk=r.read(1024*1024)
                        if not chunk: break
                        f.write(chunk)
                subprocess.run(['ffmpeg','-y','-i',src,'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-movflags','+faststart',dst],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            self._json(200,{'ok':True,'file':dst})
        except Exception as e: self._json(500,{'ok':False,'error':str(e)})

if __name__=='__main__':
    print(f'FFmpeg helper listening on http://{HOST}:{PORT}')
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
