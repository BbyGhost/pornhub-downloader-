#!/usr/bin/env python3
import json, os, shutil, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST='127.0.0.1'; PORT=8765
OUT=os.path.join(os.path.dirname(__file__),'converted'); os.makedirs(OUT,exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def _json(self, code, data):
        raw=json.dumps(data).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_OPTIONS(self): self._json(204,{})
    def do_GET(self): self._json(200,{'ok':True,'service':'uvd-ffmpeg-helper'})
    def do_POST(self):
        if self.path!='/convert': self._json(404,{'ok':False,'error':'Not found'}); return
        try: data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')) or 0))
        except Exception: self._json(400,{'ok':False,'error':'Invalid JSON'}); return
        url=data.get('url','').strip(); filename=os.path.basename(data.get('filename','video.mp4'))
        if not url.startswith(('http://','https://')): self._json(400,{'ok':False,'error':'Only HTTP(S) media URLs are supported'}); return
        if not shutil.which('ffmpeg'): self._json(500,{'ok':False,'error':'FFmpeg is not installed or not on PATH'}); return
        out=os.path.join(OUT, filename if filename.lower().endswith('.mp4') else filename+'.mp4')
        referer=data.get('referer','')
        cmd=['ffmpeg','-y','-hide_banner','-loglevel','error']
        if referer: cmd += ['-headers',f'Referer: {referer}\r\n']
        cmd += ['-i',url,'-c','copy','-movflags','+faststart',out]
        threading.Thread(target=lambda: subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL),daemon=True).start()
        self._json(202,{'ok':True,'message':'Conversion started','output':out})

if __name__=='__main__':
    print(f'Universal Video Downloader FFmpeg helper: http://{HOST}:{PORT}')
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
