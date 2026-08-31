#!/usr/bin/env python3
# @artifact dev
"""Optional AI coach sidecar. Not part of the deterministic core.

Serves the standalone build and talks to local Ollama (small Granite by
default, single-pass NDJSON stream). The page owns the UI. Gate 4: only
relative /api/coach/.

  python3 tools/coach/serve.py

Then open http://127.0.0.1:8766/

Env: COACH_MODEL (default granite4:1b), COACH_PORT (default 8766).
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
COACH = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "experion-station-sim-standalone.html"
PORT = int(os.environ.get("COACH_PORT", "8766"))
MODEL = os.environ.get("COACH_MODEL", "granite4:1b")
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
HOST = "127.0.0.1"
_THINK_RAW = os.environ.get("COACH_THINK", "false").strip().lower()
if _THINK_RAW in ("0", "false", "off", "no"):
    THINK = False
elif _THINK_RAW in ("1", "true", "on", "yes"):
    THINK = "low"
else:
    THINK = _THINK_RAW
TIP_WORDS = 42
ASK_WORDS = 76

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

GUIDE_FILE = COACH / "guide.txt"
GUIDE = ""
if GUIDE_FILE.exists():
    GUIDE = "\n".join(
        line for line in GUIDE_FILE.read_text(encoding="utf-8").splitlines()
        if "@artifact" not in line
    ).strip()

def scrub(text: str) -> str:
    t = text or ""
    for token in BANNED:
        t = t.replace(token, "[hidden]")
    return t


def spoken_cap(kind: str) -> int:
    return TIP_WORDS if kind == "tip" else ASK_WORDS


def screen_line(proj: dict) -> str:
    sc = proj.get("screen") if isinstance(proj.get("screen"), dict) else {}
    bits = []
    name = sc.get("displayName") or sc.get("display") or proj.get("display") or "unknown"
    unit = sc.get("unit") or proj.get("unit") or ""
    unit_bit = (" " + unit) if unit and (sc.get("display") == "graphic" or name == "UNIT GRAPHIC") else ""
    bits.append("display %s%s" % (name, unit_bit))
    sel = sc.get("selected") or proj.get("sel")
    if sel:
        desc = sc.get("selectedDesc") or ""
        bits.append("selected %s%s" % (sel, (" " + desc) if desc else ""))
    fps = sc.get("faceplates") or []
    if fps:
        bits.append("faceplates " + ",".join(str(x) for x in fps[:6]))
    if sc.get("archOn"):
        bits.append("ARCH %s node %s" % (sc.get("archMode") or "", sc.get("archSel") or sc.get("archTag") or ""))
    drill = proj.get("drill") if isinstance(proj.get("drill"), dict) else None
    if drill and drill.get("id"):
        bits.append("drill %s %s" % (drill.get("id"), drill.get("title") or ""))
    unack = sc.get("unack")
    if unack is not None:
        bits.append("%s UNACK" % unack)
    return "; ".join(bits) if bits else "board snapshot only"


def _question_topic(ask: str, projection: dict) -> str:
    q = (ask or "").lower()
    if any(x in q for x in ("faceplate", " mode", "manual", " auto", " cas", "program", "setpoint", " sp", "output", " op")):
        return "faceplates"
    if any(x in q for x in ("alarm", "unack", "ack", "shelv", "silence", "horn", "priority", "color")):
        return "alarms"
    if any(x in q for x in ("arch", "signal path", "layer", "topology")):
        return "arch"
    if any(x in q for x in ("key", "command", "shortcut")):
        return "keys"
    if any(x in q for x in ("trip", "interlock", "lockout")):
        return "trips"
    if any(x in q for x in ("unit", "u1", "u2", "u3", "reactor", "heater")):
        return "units"
    if any(x in q for x in ("screen", "display", "looking at", "program", "station", "drive this")):
        return "screens"
    sc = projection.get("screen") if isinstance(projection.get("screen"), dict) else {}
    return "arch" if sc.get("archOn") else "overview"


def _named_tags(ask: str) -> list[str]:
    # Simulator tags are compact (FIC102, TIC201, M202). Common prose such as
    # "AUTO" must not be mistaken for a tag, so require at least one digit.
    return list(dict.fromkeys(re.findall(r"\b[A-Z]{1,5}-?\d{2,4}[A-Z]?\b", (ask or "").upper())))[:4]


def context_pack(ask: str, projection: dict) -> dict:
    """Compact trainee-safe facts for one model pass; never hand it the whole board."""
    projection = projection if isinstance(projection, dict) else {}
    alarms = projection.get("alarms") if isinstance(projection.get("alarms"), list) else []
    points = projection.get("points") if isinstance(projection.get("points"), list) else []
    chosen = []
    seen = set()

    def add_point(row):
        if not isinstance(row, dict):
            return
        tag = str(row.get("tag") or "")
        if not tag or tag in seen:
            return
        seen.add(tag)
        chosen.append(row)

    for tag in _named_tags(ask):
        add_point(_find_point(projection, tag))
    selected = (projection.get("screen") or {}).get("selected") if isinstance(projection.get("screen"), dict) else None
    if selected:
        add_point(_find_point(projection, str(selected)))
    for alarm in alarms[:6]:
        if isinstance(alarm, dict):
            add_point(_find_point(projection, str(alarm.get("tag") or "")))
    for row in points[:8]:
        add_point(row)

    topic = _question_topic(ask, projection)
    guide = _guide_section(topic)
    return {
        "lookingAt": screen_line(projection),
        "screen": projection.get("screen"),
        "alarms": alarms[:6],
        "points": chosen[:8],
        "selectedAlarm": projection.get("selected"),
        "selectedAlarmHelp": projection.get("help"),
        "drill": projection.get("drill"),
        "arch": projection.get("arch"),
        "guide": guide[:1000],
    }


def user_task(kind: str, ask: str, projection: dict) -> str:
    facts = json.dumps(context_pack(ask, projection), ensure_ascii=False, separators=(",", ":"))
    if kind == "explain":
        task = "Explain the selected alarm, or the highest-priority active alarm."
        cap = ASK_WORDS
        shape = "Priority, evidence to check, then one safe next move."
    elif kind == "ask":
        task = "Answer the operator's question: " + (ask or "(empty)")
        cap = ASK_WORDS
        shape = "Answer first. Then the next useful check or click."
    else:
        task = "A new UNACK alarm episode settled. Call out only the highest priority and the first independent check."
        cap = TIP_WORDS
        shape = "One or two sentences. No alarm-list recap."
    return (
        "LIVE BOARD FACTS (authoritative; do not reinterpret units or alarm abbreviations):\n"
        + facts + "\n\nTASK: " + task + "\n"
        + "SHAPE: " + shape + "\n"
        + "LIMIT: %s words. Speak as PIP immediately; no headings, labels, preamble, or JSON recap." % cap
    )


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


def _find_point(proj: dict, tag: str) -> dict | None:
    want = (tag or "").strip().upper()
    if not want:
        return None
    for bucket in (proj.get("points"), proj.get("catalog")):
        if not isinstance(bucket, list):
            continue
        for row in bucket:
            if isinstance(row, dict) and str(row.get("tag") or "").upper() == want:
                return row
    return None


def _guide_section(topic: str) -> str:
    if not GUIDE:
        return "No station guide loaded."
    q = (topic or "overview").strip().lower()
    aliases = {
        "overview": "OVERVIEW",
        "program": "OVERVIEW",
        "sim": "OVERVIEW",
        "station": "OVERVIEW",
        "screen": "SCREENS",
        "screens": "SCREENS",
        "display": "SCREENS",
        "graphic": "SCREENS",
        "keys": "KEYS AND COMMANDS",
        "commands": "KEYS AND COMMANDS",
        "hotkey": "KEYS AND COMMANDS",
        "faceplate": "FACEPLATES AND MODES",
        "faceplates": "FACEPLATES AND MODES",
        "mode": "FACEPLATES AND MODES",
        "pid": "FACEPLATES AND MODES",
        "units": "UNITS",
        "unit": "UNITS",
        "u1": "UNITS",
        "u2": "UNITS",
        "u3": "UNITS",
        "alarm": "ALARMS",
        "alarms": "ALARMS",
        "ack": "ALARMS",
        "arch": "ARCH",
        "architecture": "ARCH",
        "trip": "TRIPS",
        "trips": "TRIPS",
        "safety": "SAFETY FOR THE COACH",
    }
    heading = aliases.get(q)
    chunks = []
    current = "OVERVIEW"
    buf = []
    for line in GUIDE.splitlines():
        if line.isupper() and line.replace(" ", "").isalpha() and len(line) < 40:
            if buf:
                chunks.append((current, "\n".join(buf).strip()))
            current = line.strip()
            buf = []
        else:
            buf.append(line)
    if buf:
        chunks.append((current, "\n".join(buf).strip()))
    if heading:
        for name, body in chunks:
            if name == heading:
                return name + "\n" + body
    hits = []
    for name, body in chunks:
        blob = (name + " " + body).lower()
        if q and q in blob:
            hits.append(name + "\n" + body)
    if hits:
        return "\n\n".join(hits[:2])[:1200]
    return chunks[0][0] + "\n" + chunks[0][1] if chunks else GUIDE[:800]


def ollama_post(messages: list, stream: bool, think, timeout: float, num_predict: int):
    body = {
        "model": MODEL,
        "stream": stream,
        "think": think,
        "messages": messages,
        "options": {"temperature": 0.2, "num_predict": num_predict, "num_ctx": 8192},
    }
    req = urllib.request.Request(
        OLLAMA.rstrip("/") + "/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=timeout)


def split_delta(prev: str, incoming: str) -> tuple[str, str]:
    if not incoming:
        return prev, ""
    if incoming.startswith(prev):
        return incoming, incoming[len(prev):]
    return prev + incoming, incoming


def word_count(s: str) -> int:
    return len([w for w in (s or "").split() if w])


def take_words(delta: str, n: int) -> str:
    if n <= 0 or not delta:
        return ""
    words = [w for w in delta.split() if w]
    if len(words) <= n:
        return delta
    lead = " " if delta[:1].isspace() else ""
    return lead + " ".join(words[:n])


def clip_spoken(text: str, max_words: int) -> str:
    t = (text or "").strip()
    if not t:
        return t
    words = t.split()
    if len(words) > max_words:
        t = " ".join(words[:max_words]).rstrip(",;:") + "."
    return t


def seed_messages(kind: str, ask: str, projection: dict, history) -> list:
    return (
        [{"role": "system", "content": SYSTEM}]
        + history_messages(history)
        + [{"role": "user", "content": user_task(kind, ask, projection)}]
    )


def stream_reply(messages: list, cap: int, emit) -> None:
    think_acc = ""
    text_acc = ""
    spoken_out = ""
    done_reason = ""
    with ollama_post(messages, True, THINK, 60, max(180, cap * 3)) as resp:
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
                emit({"t": "think", "d": scrub(tdelta)})
            if xdelta:
                room = cap - word_count(spoken_out)
                piece = take_words(xdelta, room)
                if piece:
                    spoken_out += (" " if spoken_out and not piece[:1].isspace() else "") + piece
                    emit({"t": "text", "d": scrub(piece)})
            if chunk.get("done"):
                done_reason = str(chunk.get("done_reason") or "")
                break
    emit({"t": "done", "ok": True, "model": MODEL, "reason": done_reason})


def ollama_chat(kind: str, ask: str, projection: dict, history=None) -> tuple[bool, str, str]:
    cap = spoken_cap(kind)
    try:
        messages = seed_messages(kind, ask, projection, history)
        with ollama_post(messages, False, THINK, 90, max(280, cap * 4)) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        msg = data.get("message") or {}
        text = clip_spoken(scrub(msg.get("content") or data.get("response") or "").strip(), cap)
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
                "tools": False,
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
        cap = spoken_cap(kind)
        try:
            messages = seed_messages(kind, ask, proj, hist)
            stream_reply(messages, cap, self._emit)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as err:
            try:
                self._emit({
                    "t": "err",
                    "d": "PIP cannot reach the local model (%s). LIVE DIAGNOSIS still works." % err.__class__.__name__,
                })
            except (BrokenPipeError, ConnectionResetError):
                return


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("AI coach sidecar on http://%s:%s/  model=%s think=%s stream=on" % (HOST, PORT, MODEL, THINK))
    print("Open that URL (not the file:// dist). PIP gets one compact, trainee-safe board context per turn.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nPIP stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
