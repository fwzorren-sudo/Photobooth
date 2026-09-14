#!/usr/bin/env python3
"""Local test server for the web booth.

    python3 serve.py            # http://localhost:8000

Browsers only hand out the camera on a secure origin, and `localhost` counts
as one -- so this is enough for testing on the machine itself. To test on an
actual iPad you need real HTTPS: deploy to GitHub Pages (see ../README.md) or
put it behind any TLS-terminating host.
"""
import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # No caching while developing; the service worker is aggressive enough.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Photo booth at http://localhost:{PORT}  (Ctrl-C to stop)")
        httpd.serve_forever()
