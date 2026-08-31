#!/usr/bin/env python3
# @artifact dev
"""Optional AI coach sidecar. Not part of the deterministic core.

The committed simulator never fetches. This process serves a copy of the
standalone build, injects tools/coach/client.js, and POSTs a TRAINEE_SAFE
projection to a local Ollama model.

  python3 tools/coach/serve.py

Then open http://127.0.0.1:8766/

Env: COACH_MODEL (default granite4.2:8b), COACH_PORT (default 8766).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
COACH = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "experion-station-sim-standalone.html"
PORT = int(os.environ.get("COACH_PORT", "8766"))
MODEL = os.environ.get("COACH_MODEL", "granite4.2:8b")
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
HOST = "127.0.0.1"

BANNED = [
    "FROZEN_MEASUREMENT", "BIASED_MEASUREMENT", "NOISY_MEASUREMENT",
    "OPEN_INPUT_BAD_QUALITY", "VALVE_RESPONSE_FAILURE",
    "CONTROLLER_LOSS", "REDUNDANCY_SWITCHOVER",
    "NET_PATH_DEGRADED", "COMMS_PARTITION",
    "SERVER_SERVICE_DEGRADED", "STATION_LOSS_PEER",
    "HISTORIAN_GAP", "ASSISTANT_LOSS", "INSTRUCTOR_ONLY",
]

PROMPT_FILE = COACH / "prompt.txt"
SYSTEM = PROMPT_FILE.read_text(encoding="utf-8") if PROMPT_FILE.exists() else (
    "You are a board-operator coach on a training simulator. Advisory only."
)


def scrub(text: str) -> str:
    t = text or ""
    for token in BANNED:
        t = t.replace(token, "[hidden]")
    return t.strip()


def user_task(kind: str, ask: str, projection: dict) -> str:
    blob = json.dumps(projection, ensure_ascii=False, separators=(",", ":"))
    if kind == "explain":
        task = "Explain the selected alarm. If none is selected, explain the highest-priority active alarm."
    elif kind == "ask":
        task = "Answer the operator question from the live board. Question: " + (ask or "(empty)")
    else:
        task = "A new unacknowledged alarm just appeared. One first look: what it means and the first check. Do not recap every alarm."
    return "BOARD JSON:\n" + blob + "\n\nTASK:\n" + task


def ollama_chat(kind: str, ask: str, projection: dict) -> tuple[bool, str]:
    body = json.dumps({
        "model": MODEL,
        "stream": False,
        "think": False,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_task(kind, ask, projection)},
        ],
        "options": {"temperature": 0.2, "num_predict": 220, "num_ctx": 8192},
    }).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA.rstrip("/") + "/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        msg = (data.get("message") or {}).get("content") or data.get("response") or ""
        return True, scrub(msg)
    except Exception as err:
        return False, "Coach sidecar cannot reach the local model (%s). LIVE DIAGNOSIS above still works." % err.__class__.__name__


def injected_html() -> bytes:
    html = DIST.read_text(encoding="utf-8")
    snippet = (
        '<script src="/coach/projection.js"></script>'
        '<script src="/coach/client.js"></script>'
    )
    if "/coach/client.js" not in html:
        if "</html>" in html:
            html = html.replace("</html>", snippet + "</html>", 1)
        else:
            html = html + snippet
    return html.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("coach: " + (fmt % args) + "\n")

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html", "/sim"):
            if not DIST.exists():
                self._send(500, b"dist missing; run python3 tools/build-dist.py", "text/plain")
                return
            self._send(200, injected_html(), "text/html; charset=utf-8")
            return
        if path == "/coach/client.js":
            self._send(200, (COACH / "client.js").read_bytes(), "text/javascript; charset=utf-8")
            return
        if path == "/coach/projection.js":
            self._send(200, (COACH / "projection.js").read_bytes(), "text/javascript; charset=utf-8")
            return
        if path == "/api/health":
            payload = json.dumps({"ok": True, "model": MODEL, "bind": "%s:%s" % (HOST, PORT)}).encode()
            self._send(200, payload, "application/json")
            return
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/advise":
            self._send(404, b"not found", "text/plain")
            return
        n = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            msg = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, b'{"ok":false,"error":"bad json"}', "application/json")
            return
        kind = str(msg.get("kind") or "tip")
        ask = str(msg.get("ask") or "")
        proj = msg.get("projection") if isinstance(msg.get("projection"), dict) else {}
        ok, text = ollama_chat(kind, ask, proj)
        payload = json.dumps({"ok": ok, "text": text, "model": MODEL if ok else None}).encode("utf-8")
        self._send(200 if ok else 503, payload, "application/json")


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("AI coach sidecar on http://%s:%s/  model=%s" % (HOST, PORT, MODEL))
    print("Open that URL (not the file:// dist). Core stays offline without this process.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
