#!/usr/bin/env python3
# @artifact dev
"""Optional AI coach sidecar. Not part of the deterministic core.

Serves the standalone build and talks to local Ollama (granite, think on,
NDJSON stream). The page owns the UI. Gate 4: only relative /api/coach/.

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
THINK = os.environ.get("COACH_THINK", "true").strip().lower() not in ("0", "false", "off", "no")

BANNED = [
    "FROZEN_MEASUREMENT", "BIASED_MEASUREMENT", "NOISY_MEASUREMENT",
    "OPEN_INPUT_BAD_QUALITY", "VALVE_RESPONSE_FAILURE",
    "CONTROLLER_LOSS", "REDUNDANCY_SWITCHOVER",
    "NET_PATH_DEGRADED", "COMMS_PARTITION",
    "SERVER_SERVICE_DEGRADED", "STATION_LOSS_PEER",
    "HISTORIAN_GAP", "ASSISTANT_LOSS", "INSTRUCTOR_ONLY",
]

PROMPT_FILE = COACH / "prompt.txt"
if PROMPT_FILE.exists():
    SYSTEM = "\n".join(
        line for line in PROMPT_FILE.read_text(encoding="utf-8").splitlines()
        if "@artifact" not in line
    ).strip()
else:
    SYSTEM = "You are PIP, a board-operator coach on a training simulator. Advisory only."


def scrub(text: str) -> str:
    t = text or ""
    for token in BANNED:
        t = t.replace(token, "[hidden]")
    return t


def user_task(kind: str, ask: str, projection: dict) -> str:
    blob = json.dumps(projection, ensure_ascii=False, separators=(",", ":"))
    if kind == "explain":
        task = "Explain the selected alarm. If none is selected, explain the highest-priority active alarm."
    elif kind == "ask":
        task = "Answer the operator. Question: " + (ask or "(empty)")
    else:
        task = "A new unacknowledged alarm just appeared. One first look: what it means and the first check. Do not recap every alarm."
    return "BOARD JSON:\n" + blob + "\n\nTASK:\n" + task


def history_messages(raw) -> list:
    out = []
    if not isinstance(raw, list):
        return out
    for item in raw[-8:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = scrub(str(item.get("content") or ""))[:800].strip()
        if role in ("user", "assistant") and content:
            out.append({"role": role, "content": content})
    return out


def chat_messages(kind: str, ask: str, projection: dict, history) -> list:
    msgs = [{"role": "system", "content": SYSTEM}]
    msgs.extend(history_messages(history))
    msgs.append({"role": "user", "content": user_task(kind, ask, projection)})
    return msgs


def chat_body(kind: str, ask: str, projection: dict, history, stream: bool) -> bytes:
    return json.dumps({
        "model": MODEL,
        "stream": stream,
        "think": THINK,
        "messages": chat_messages(kind, ask, projection, history),
        "options": {"temperature": 0.35, "num_predict": 900, "num_ctx": 8192},
    }).encode("utf-8")


def ollama_open(kind: str, ask: str, projection: dict, history, stream: bool, timeout: float):
    req = urllib.request.Request(
        OLLAMA.rstrip("/") + "/api/chat",
        data=chat_body(kind, ask, projection, history, stream),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=timeout)


def split_delta(prev: str, incoming: str) -> tuple[str, str]:
    """Ollama may send a token or the whole string so far. Return (new_acc, delta)."""
    if not incoming:
        return prev, ""
    if incoming.startswith(prev):
        return incoming, incoming[len(prev):]
    return prev + incoming, incoming


def ollama_chat(kind: str, ask: str, projection: dict, history=None) -> tuple[bool, str, str]:
    try:
        with ollama_open(kind, ask, projection, history, False, 90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        msg = data.get("message") or {}
        text = scrub(msg.get("content") or data.get("response") or "").strip()
        thinking = scrub(msg.get("thinking") or "").strip()
        return True, text, thinking
    except Exception as err:
        return False, "PIP cannot reach the local model (%s). LIVE DIAGNOSIS still works." % err.__class__.__name__, ""


def injected_html() -> bytes:
    return DIST.read_bytes()


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

    def _read_msg(self):
        n = int(self.headers.get("Content-Length") or "0")
        if n > 80000:
            return None
        raw = self.rfile.read(n) if n else b"{}"
        try:
            msg = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None
        if not isinstance(msg, dict):
            return None
        kind = str(msg.get("kind") or "tip")
        ask = str(msg.get("ask") or "")
        proj = msg.get("projection") if isinstance(msg.get("projection"), dict) else {}
        hist = msg.get("history")
        return kind, ask, proj, hist

    def _emit(self, obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False).encode("utf-8") + b"\n"
        self.wfile.write(line)
        self.wfile.flush()

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
        if path in ("/api/health", "/api/coach/health"):
            payload = json.dumps({
                "ok": True,
                "model": MODEL,
                "bind": "%s:%s" % (HOST, PORT),
                "think": THINK,
                "stream": True,
                "pal": "PIP",
            }).encode()
            self._send(200, payload, "application/json")
            return
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        parsed = self._read_msg()
        if parsed is None:
            self._send(400, b'{"ok":false,"error":"bad json"}', "application/json")
            return
        kind, ask, proj, hist = parsed
        if path in ("/api/advise", "/api/coach/advise"):
            ok, text, thinking = ollama_chat(kind, ask, proj, hist)
            payload = json.dumps({
                "ok": ok,
                "text": text,
                "thinking": thinking,
                "model": MODEL if ok else None,
            }).encode("utf-8")
            self._send(200 if ok else 503, payload, "application/json")
            return
        if path not in ("/api/stream", "/api/coach/stream"):
            self._send(404, b"not found", "text/plain")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        think_acc = ""
        text_acc = ""
        try:
            with ollama_open(kind, ask, proj, hist, True, 120) as resp:
                while True:
                    line = resp.readline()
                    if not line:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line.decode("utf-8"))
                    except json.JSONDecodeError:
                        continue
                    msg = chunk.get("message") or {}
                    think_acc, tdelta = split_delta(think_acc, msg.get("thinking") or "")
                    text_acc, xdelta = split_delta(text_acc, msg.get("content") or "")
                    if tdelta:
                        self._emit({"t": "think", "d": scrub(tdelta)})
                    if xdelta:
                        self._emit({"t": "text", "d": scrub(xdelta)})
                    if chunk.get("done"):
                        break
            self._emit({"t": "done", "ok": True, "model": MODEL})
        except Exception as err:
            self._emit({
                "t": "err",
                "d": "PIP cannot reach the local model (%s). LIVE DIAGNOSIS still works." % err.__class__.__name__,
            })


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("AI coach sidecar on http://%s:%s/  model=%s think=%s" % (HOST, PORT, MODEL, THINK))
    print("Open that URL (not the file:// dist). PIP streams from granite. Core stays offline without this process.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
