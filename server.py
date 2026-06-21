#!/usr/bin/env python3
"""
openworld — billboarded 2D sprites walking around a 3D world, in the browser.

The Doom / Daggerfall / Might & Magic 6-8 rendering trick: real 3D geometry
for the environment, flat camera-facing sprites for the actors, with 8
pre-drawn directional frames swapped by viewing angle. All client-side
(Three.js); this server just hands out the static files.

Port 8111 (registered in ~/bub/ports.json, proxied by Caddy behind auth like
every app). Binds 127.0.0.1 only — the LAN side is Caddy's. Stdlib only.

  GET /         the app
  GET /health   liveness probe (used by healthcheck.py)
  GET /<file>   static assets from this directory (e.g. future sprite sheets)
"""

import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

PORT = 8111
BASE = Path(__file__).resolve().parent
SOUNDS_DIR = (Path.home() / "sounds" /
              "1992 - Heroes of Might and Magic II - The Succession Wars").resolve()


class Handler(BaseHTTPRequestHandler):
    server_version = "openworld"
    protocol_version = "HTTP/1.1"

    def reply(self, status, body, ctype):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _serve_audio(self, path):
        """Stream an audio file with Range request support (required by browsers)."""
        size = path.stat().st_size
        ctype = "audio/flac"
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes="):
            try:
                lo, hi = rng[6:].split("-", 1)
                start = int(lo) if lo else 0
                end   = int(hi) if hi else size - 1
            except ValueError:
                start, end = 0, size - 1
            end = min(end, size - 1)
            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            if self.command != "HEAD":
                with open(path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
        else:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            if self.command != "HEAD":
                with open(path, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)

    def do_GET(self):
        path = self.path.partition("?")[0]

        if path == "/health":
            self.reply(200, "ok", "text/plain")
            return
        if path == "/":
            path = "/index.html"

        # Sound files from the HoMM2 soundtrack directory.
        if path.startswith("/sounds/"):
            filename = unquote(path[len("/sounds/"):])
            target = (SOUNDS_DIR / filename).resolve()
            if SOUNDS_DIR not in target.parents or not target.is_file():
                self.reply(404, "not found", "text/plain")
                return
            self._serve_audio(target)
            return

        # Resolve under BASE and refuse anything that escapes the directory.
        target = (BASE / path.lstrip("/")).resolve()
        if BASE not in target.parents and target != BASE or not target.is_file():
            self.reply(404, "not found", "text/plain")
            return

        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.reply(200, target.read_bytes(), ctype)

    do_HEAD = do_GET

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
