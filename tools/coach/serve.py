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
import threading
import time
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
# Optional CLOUD provider for PIP's judgment (Anthony, 2026-09-03: the local model
# read the board correctly and still misdiagnosed a bad-quality PV as a process
# effect). The default stays local: set COACH_PROVIDER=anthropic to route PIP through
# the Anthropic API. Gate 4 is untouched either way: the station page only ever talks
# to this sidecar's relative /api/coach/ endpoints, the deterministic core never waits
# on it, and file:// stays offline. The context sent is the same trainee-safe board
# projection in both cases; no employer or real-site material exists in this product.
PROVIDER = os.environ.get("COACH_PROVIDER", "ollama").strip().lower() or "ollama"
if PROVIDER not in ("ollama", "anthropic"):
    raise SystemExit("COACH_PROVIDER must be 'ollama' or 'anthropic', not %r" % PROVIDER)
CLOUD_MODEL = os.environ.get("COACH_CLOUD_MODEL", "claude-opus-5")
CLOUD_EFFORT = os.environ.get("COACH_CLOUD_EFFORT", "medium").strip().lower() or "medium"
if PROVIDER == "anthropic":
    MODEL = CLOUD_MODEL   # health, the done frame and the page badge report the model actually served
LOCAL_MODEL = os.environ.get("COACH_MODEL", "granite4:1b")
# Keep the local model loaded between questions, and load it once at startup. On the first
# live run the 8B model took over three minutes to answer its first question and PIP sat in
# THINKING the whole time -- the exact impression the coach must never give an operator.
KEEP_ALIVE = os.environ.get("COACH_KEEP_ALIVE", "30m")
WARM = os.environ.get("COACH_WARM", "1").strip().lower() not in ("0", "false", "off", "no")
WARM_STATE = {"ready": None, "seconds": None}   # ready: None until known or if the warm-up failed

# Runtime provider and credential, settable from the station's CLOUD KEY dialog (a masked
# input, SUPV or above). MEMORY ONLY: never written to disk, never logged (the request log
# carries the request line, not the body), never echoed by any endpoint, never part of the
# model context. Restarting the sidecar forgets it. A key entered at the station outranks
# whatever the environment or an `ant auth login` profile would have supplied.
RUNTIME = {"provider": PROVIDER, "key": None, "model": None}


def _provider() -> str:
    return RUNTIME["provider"]


def _model() -> str:
    if _provider() == "anthropic":
        return RUNTIME["model"] or CLOUD_MODEL
    return LOCAL_MODEL


def _fallback_credential_state() -> str:
    """What the cloud would authenticate with if no key were entered at the station.

    "env" is ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN; "profile" is the machine's own
    `ant auth login` sign-in, which the SDK resolves on its own and which bills THAT
    account -- so it is named, never hidden behind "unknown". "none" means a switch to
    the cloud provider is refused until a key is entered.
    """
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return "env"
    try:
        from anthropic.lib.credentials import default_credentials
        if default_credentials() is not None:
            return "profile"
    except Exception:
        pass
    return "none"


def _credential_state() -> str:
    return "session" if RUNTIME["key"] else _fallback_credential_state()


def _redact(text) -> str:
    """The station key must never appear in any string that leaves this process."""
    text = "" if text is None else str(text)
    key = RUNTIME.get("key")
    return text.replace(key, "[key]") if key else text
_THINK_RAW = os.environ.get("COACH_THINK", "false").strip().lower()
if _THINK_RAW in ("0", "false", "off", "no"):
    THINK = False
elif _THINK_RAW in ("1", "true", "on", "yes"):
    THINK = "low"
else:
    THINK = _THINK_RAW
TIP_WORDS = 70
# Re-measured 2026-09-03 with the alarm help in the context: the 8B model's asks ran to
# ~160 words and were discarded by a 120-word cap. 200 keeps ~25 % headroom over that.
ASK_WORDS = 200

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

# ---------------------------------------------------------------------------
# The plant orientation document.
#
# src/process.js carries the operator-facing process description between
# PROCESS-TEXT sentinels precisely so this file can read it as plain text
# without executing JavaScript. One copy of the prose, shared by the PROC
# dialog the operator opens and the context PIP is given. If they were two
# copies they would drift, and the operator would be the one to find out.
PROCESS_FILE = COACH.parent.parent / "src" / "process.js"
PROCESS_TEXT = ""
PROCESS_SECTIONS: dict[str, str] = {}
PROCESS_ORDER: list[str] = []


def _load_process_text() -> None:
    """Read the sentinel-delimited document and split it on its own headings.

    Uses the SAME heading rule as _guide_section below, so the operator's
    dialog and PIP can never disagree about where a section begins.
    """
    global PROCESS_TEXT
    if not PROCESS_FILE.exists():
        return
    raw = PROCESS_FILE.read_text(encoding="utf-8")
    m = re.search(r"/\* PROCESS-TEXT-BEGIN \*/(.*?)/\* PROCESS-TEXT-END \*/", raw, re.S)
    if not m:
        return
    # The block is a JS array of single-quoted lines joined by newlines. Pull the
    # string literals out rather than eval anything.
    lines = []
    for lit in re.finditer(r"^\s*'((?:[^'\\]|\\.)*)',?\s*$", m.group(1), re.M):
        lines.append(lit.group(1).replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\"))
    PROCESS_TEXT = "\n".join(lines).strip()
    cur = None
    for line in PROCESS_TEXT.splitlines():
        t = line.strip()
        if t and len(t) < 40 and t.isupper() and t.replace(" ", "").isalpha():
            cur = t
            PROCESS_ORDER.append(cur)
            PROCESS_SECTIONS[cur] = ""
        elif cur:
            PROCESS_SECTIONS[cur] += line + "\n"
    for k in PROCESS_SECTIONS:
        PROCESS_SECTIONS[k] = PROCESS_SECTIONS[k].strip()


_load_process_text()

# Which orientation section belongs to which unit the operator is looking at.
# Routed by the unit the station reports, NOT by keyword matching on the
# question -- the autonomous tip and the EXPLAIN ALARM button both send an
# empty ask, and keyword routing hands those paths nothing. Those are exactly
# the two paths that failed in front of operators.
_UNIT_SECTION = {
    "U1": "UNIT ONE RECEIPT AND CONVERSION",
    "U2": "UNIT TWO BATCH CAMPAIGN REACTOR",
    "U3": "UNIT THREE HYDROFINISHING",
}


def _process_section(unit: str, focus_tags=None) -> str:
    """The orientation text for the unit on screen, plus what the plant makes.

    focus_tags: point tags the request is actually about (named in the ask, the
    selected point, the tags in alarm). Paragraphs of the unit section that
    name one of them are moved to the front, in document order, so the part
    that matters survives the caller's character cap. The Unit One section is
    ~3 000 characters and the cap is 900: without this, the E-301 paragraph
    (offset ~1 900) never reached the model even with TIC301 in alarm. Routed
    by hard facts the station sends, never by free-text keywords.
    """
    if not PROCESS_SECTIONS:
        return ""
    # Unit-specific ONLY. What the plant makes is already unconditional in the
    # SYSTEM prompt, so repeating it here would spend most of the per-request
    # budget restating something the model already has, and the unit detail --
    # the part that changes with the screen -- would be the bit truncated away.
    key = _UNIT_SECTION.get(str(unit or "").strip().upper())
    if key and PROCESS_SECTIONS.get(key):
        body = PROCESS_SECTIONS[key]
        tags = [str(t) for t in (focus_tags or []) if t]
        if tags:
            paras = [p for p in body.split("\n\n") if p.strip()]
            hit = [p for p in paras if any(t in p for t in tags)]
            rest = [p for p in paras if p not in hit]
            body = "\n\n".join(hit + rest)
        return key + "\n" + body
    # No unit on screen (plant overview, alarm summary): fall back to the route,
    # which is short and orients without duplicating SYSTEM.
    route = PROCESS_SECTIONS.get("THE ROUTE THROUGH THE PLANT", "")
    return ("THE ROUTE THROUGH THE PLANT\n" + route).strip() if route else ""


def _plant_identity() -> str:
    """A short, ALWAYS-PRESENT statement of what plant PIP is standing in.

    This goes in the SYSTEM prompt rather than the per-request context because
    it must survive the paths that send no question at all.
    """
    if not PROCESS_SECTIONS:
        return ""
    makes = PROCESS_SECTIONS.get("WHAT THE PLANT MAKES", "")
    route = PROCESS_SECTIONS.get("THE ROUTE THROUGH THE PLANT", "")
    body = (makes + "\n\n" + route).strip()
    words = body.split()
    if len(words) > 230:
        body = " ".join(words[:230]) + " ..."
    return (
        "\n\nTHE PLANT YOU ARE STANDING IN (authoritative; the operator can read "
        "the same document from the PROC display):\n" + body +
        "\n\nThis plant is simulated and generic. Never present it as a real "
        "company's plant, and never invent equipment that is not on the board."
    )


# Appended, never merged into prompt.txt -- tests/coach-stream.test.js pins six
# phrases in that file verbatim.
SYSTEM = SYSTEM + _plant_identity()


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
        t = re.sub(re.escape(token), "[hidden]", t, flags=re.IGNORECASE)
    return t


def partial_banned_suffix(text: str) -> int:
    """Hold a trailing prefix of a banned token until the next stream chunk."""
    best = 0
    for token in BANNED:
        # A complete token can be scrubbed now. Only a proper prefix must wait.
        limit = min(len(text), len(token) - 1)
        for size in range(limit, 0, -1):
            if text[-size:].casefold() == token[:size].casefold():
                best = max(best, size)
                break
    return best


class StreamScrubber:
    """Redact tokens even when an Ollama stream splits them across chunks."""

    def __init__(self) -> None:
        self.pending = ""

    def push(self, text: str, final: bool = False) -> str:
        self.pending += text or ""
        if final:
            held = partial_banned_suffix(self.pending)
            # One- and two-letter overlaps are ordinary word endings (for example
            # "temperature" ends in "re"). Hide only a meaningfully identifying
            # terminal prefix; short overlaps are safe to release through scrub().
            if held >= 4:
                stable = self.pending[:-held] + "[hidden]"
                self.pending = ""
                return scrub(stable)
        hold = 0 if final else partial_banned_suffix(self.pending)
        stable = self.pending[:-hold] if hold else self.pending
        self.pending = self.pending[-hold:] if hold else ""
        return scrub(stable)


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

    # What this request is ABOUT, as hard facts: tags named in the ask, the
    # selected point, and the tags in alarm -- not the whole unit's point list,
    # which would make every paragraph a "hit" and restore document order.
    focus = list(_named_tags(ask))
    if selected:
        focus.append(str(selected))
    for alarm in alarms[:6]:
        if isinstance(alarm, dict) and alarm.get("tag"):
            focus.append(str(alarm.get("tag")))

    # The station already sends a catalog of every configured point with its
    # description on EVERY request; context_pack used it only as a lookup table
    # inside _find_point and never showed it to the model. Render it as a
    # one-line-per-tag nameplate so PIP knows what the tags on this unit ARE.
    # Zero new authoring: this content was already crossing the wire.
    unit = str(projection.get("unit") or (projection.get("screen") or {}).get("unit") or "")
    nameplate = []
    for row in (projection.get("catalog") or [])[:60]:
        if not isinstance(row, dict):
            continue
        tag = str(row.get("tag") or "")
        desc = str(row.get("desc") or "")
        if tag and desc:
            nameplate.append(tag + " = " + desc)
    nameplate = "; ".join(nameplate)[:900]
    return {
        "lookingAt": screen_line(projection),
        "screen": projection.get("screen"),
        "alarms": alarms[:6],
        "points": chosen[:8],
        "selectedAlarm": projection.get("selected"),
        "selectedAlarmHelp": projection.get("help"),
        "helpFor": projection.get("helpFor"),   # which alarm that help belongs to (the selected one, or the top one)
        "drill": projection.get("drill"),
        "arch": projection.get("arch"),
        "process": _process_section(unit, focus)[:900],
        "nameplate": nameplate,
        "guide": guide[:1000],
    }


def user_task(kind: str, ask: str, projection: dict) -> str:
    packed = context_pack(ask, projection)
    facts = json.dumps(packed, ensure_ascii=False, separators=(",", ":"))
    drill = packed.get("drill") if isinstance(packed.get("drill"), dict) else {}
    cue_notice = ""
    if drill.get("observationGrade") == "SIMULATED_ARCHITECTURE_INDICATION":
        cue_notice = (
            "\nDRILL CUE GRADE: drill.observations are authored simulated architecture "
            "indications, not measured process values. Present them as cues to investigate; "
            "do not promote them to confirmed board facts or a root cause.\n"
        )
    if kind == "explain":
        task = ("Explain the selected alarm, or the highest-priority active alarm. selectedAlarmHelp is that "
                "alarm's rationalised help (consequence, probable cause, corrective action) and is authoritative: "
                "a BADPV or bad-quality condition means the measurement cannot be trusted, never that the process moved.")
        cap = ASK_WORDS
        shape = "Priority, evidence to check, then one safe next move."
    elif kind == "ask":
        task = "Answer the operator's question: " + (ask or "(empty)")
        cap = ASK_WORDS
        shape = "Answer first, in one or two sentences. Then the single most useful check or click. Stop there."
    else:
        task = "A new UNACK alarm episode settled. Call out only the highest priority and the first independent check."
        cap = TIP_WORDS
        shape = "One or two sentences. No alarm-list recap."
    if _provider() == "anthropic":
        # The cloud model follows a length request; a complete answer matters more than the
        # count, so the limit is guidance here and the sidecar never discards a finished answer.
        limit = ("LENGTH: aim for about %s words and never pad; a complete answer beats a short one. "
                 "Speak as PIP immediately; no headings, labels, preamble, or JSON recap." % cap)
    else:
        limit = "LIMIT: %s words. Speak as PIP immediately; no headings, labels, preamble, or JSON recap." % cap
    return (
        "BOARD CONTEXT (point and alarm values are authoritative; do not reinterpret units or alarm abbreviations):\n"
        + facts + cue_notice + "\nTASK: " + task + "\n"
        + "SHAPE: " + shape + "\n"
        + limit
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


class CapExceeded(RuntimeError):
    """The model answered correctly but ran past the local spoken-word cap.

    Kept as a hard failure on purpose: a truncated coaching answer that looks
    complete is worse than no answer, and tests/coach-sidecar.test.js pins that
    a capped stream must fail visibly rather than return partial text as
    success. What was WRONG was the reporting. Every exception -- cap over-run,
    malformed NDJSON, a genuine connection failure -- was collapsed into
    "PIP cannot reach the local model", so an operator watched a correct answer
    stream in, get discarded, and be blamed on the network. Six distinct
    failures wore one lie. This class exists so the message can tell the truth.
    """


class CloudRefused(RuntimeError):
    """The cloud model declined on policy (stop_reason 'refusal'): not an outage, not a cap."""


class CloudIncomplete(RuntimeError):
    """The cloud stream ended before a complete answer (max_tokens or a foreign stop reason)."""


def _failure_message(err: Exception) -> str:
    if isinstance(err, CapExceeded):
        return ("PIP had more to say than it is allowed to say here and stopped "
                "rather than cut a sentence in half. Ask again more narrowly. "
                "The model is fine; LIVE DIAGNOSIS is unaffected.")
    if isinstance(err, CloudRefused):
        return ("PIP declined to answer that one (safety policy on the cloud model). "
                "Ask about the board instead. LIVE DIAGNOSIS still works.")
    if isinstance(err, CloudIncomplete):
        return ("PIP's cloud answer was cut off before it finished (%s). Ask again. "
                "LIVE DIAGNOSIS still works." % _redact(err))
    name = err.__class__.__name__
    if _provider() == "anthropic":
        if name == "AuthenticationError":
            state = _credential_state()
            if state == "session":
                return ("The cloud key entered at this station was rejected by the API. Re-enter it "
                        "(Help -> PIP cloud credential). LIVE DIAGNOSIS still works.")
            if state == "env":
                return ("The cloud credential in the sidecar's environment (ANTHROPIC_API_KEY / "
                        "ANTHROPIC_AUTH_TOKEN) was rejected by the API. LIVE DIAGNOSIS still works.")
            if state == "profile":
                return ("This machine's `ant auth login` sign-in was rejected by the API: run "
                        "`ant auth login` again, or enter a key at the station. LIVE DIAGNOSIS still works.")
            return ("PIP has no cloud credentials: enter a key at the station (Help -> PIP cloud "
                    "credential), run `ant auth login`, or set ANTHROPIC_API_KEY. LIVE DIAGNOSIS still works.")
        if name in ("BadRequestError", "PermissionDeniedError", "NotFoundError"):
            # A rejected request is a configuration problem (model id, a parameter the
            # account cannot use), not an outage: say what the API said, so it can be fixed.
            detail = _redact(getattr(err, "message", "") or err)[:200]
            return ("PIP's cloud request was rejected (%s: %s). Check COACH_CLOUD_MODEL and the "
                    "sidecar log. LIVE DIAGNOSIS still works." % (name, detail))
        return "PIP cannot reach the cloud model (%s). LIVE DIAGNOSIS still works." % name
    return "PIP cannot reach the local model (%s). LIVE DIAGNOSIS still works." % name

def _failure_reason(err: Exception) -> str:
    if isinstance(err, CapExceeded):
        return "cap"
    if isinstance(err, CloudRefused):
        return "refusal"
    return "model"


def ollama_post(messages: list, stream: bool, think, timeout: float, num_predict: int):
    body = {
        "model": LOCAL_MODEL,
        "stream": stream,
        "keep_alive": KEEP_ALIVE,
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


def warm_local_model() -> None:
    """Load the local model in the background so the first question does not pay the load
    time. Health reports warm: false until this finishes and the page shows LOADING."""
    t0 = time.time()
    WARM_STATE["ready"] = False
    try:
        with ollama_post([{"role": "user", "content": "warm"}], False, False, 900, 1) as resp:
            resp.read()
        WARM_STATE.update(ready=True, seconds=round(time.time() - t0, 1))
        sys.stderr.write("coach: model %s warm in %ss\n" % (LOCAL_MODEL, WARM_STATE["seconds"]))
    except Exception as err:
        WARM_STATE.update(ready=None, seconds=round(time.time() - t0, 1))   # unknown, not "loading forever"
        sys.stderr.write("coach: warm-up of %s failed (%s)\n" % (LOCAL_MODEL, err.__class__.__name__))


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
    think_scrubber = StreamScrubber()
    text_scrubber = StreamScrubber()
    saw_done = False
    locally_truncated = False
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
            except json.JSONDecodeError as err:
                raise RuntimeError("Ollama stream emitted malformed NDJSON") from err
            msg = chunk.get("message") or {}
            think_acc, tdelta = split_delta(think_acc, msg.get("thinking") or "")
            text_acc, xdelta = split_delta(text_acc, msg.get("content") or "")
            if tdelta:
                safe_think = think_scrubber.push(tdelta)
                if safe_think:
                    emit({"t": "think", "d": safe_think})
            if xdelta:
                candidate = spoken_out + xdelta
                # Count the reconstructed answer, not each delta independently:
                # Ollama may split the last allowed word across two chunks.
                if word_count(candidate) > cap:
                    locally_truncated = True
                elif not locally_truncated:
                    # Ollama's chunks are exact text deltas. Adding a separator here
                    # corrupts words split across chunks and can also defeat redaction.
                    spoken_out = candidate
                    safe_text = text_scrubber.push(xdelta)
                    if safe_text:
                        emit({"t": "text", "d": safe_text})
            if chunk.get("done"):
                saw_done = True
                done_reason = str(chunk.get("done_reason") or "")
                break
    if not saw_done:
        raise RuntimeError("Ollama stream ended without a terminal done event")
    if done_reason and done_reason != "stop":
        raise RuntimeError("Ollama stream ended before completion: " + done_reason)
    if locally_truncated:
        raise CapExceeded("answer exceeded the local spoken-word cap")
    if not spoken_out.strip():
        raise RuntimeError("Ollama stream completed without an answer")
    final_think = think_scrubber.push("", final=True)
    if final_think:
        emit({"t": "think", "d": final_think})
    final_text = text_scrubber.push("", final=True)
    if final_text:
        emit({"t": "text", "d": final_text})
    emit({"t": "done", "ok": True, "model": _model(), "reason": done_reason})


def ollama_chat(kind: str, ask: str, projection: dict, history=None) -> tuple[bool, str, str]:
    cap = spoken_cap(kind)
    try:
        messages = seed_messages(kind, ask, projection, history)
        with ollama_post(messages, False, THINK, 90, max(280, cap * 4)) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        msg = data.get("message") or {}
        raw_text = scrub(msg.get("content") or data.get("response") or "").strip()
        done_reason = str(data.get("done_reason") or "")
        if data.get("done") is not True:
            raise RuntimeError("Ollama response ended without a terminal done event")
        if done_reason and done_reason != "stop":
            raise RuntimeError("Ollama response ended before completion: " + done_reason)
        if word_count(raw_text) > cap:
            raise CapExceeded("answer exceeded the local spoken-word cap")
        text = clip_spoken(raw_text, cap)
        thinking = scrub(msg.get("thinking") or "").strip()
        if not text:
            raise RuntimeError("Ollama response contained no answer")
        return True, text, thinking
    except Exception as err:
        return False, "PIP cannot reach the local model (%s). LIVE DIAGNOSIS still works." % err.__class__.__name__, ""


# ---------------------------------------------------------------------------
# Cloud provider: the Anthropic API through the official SDK (imported lazily, so the
# default Ollama path stays stdlib-only). Same frames, same spoken-word cap, same
# trainee-safe scrubbing as the local path; only the model behind them changes.
_ANTHROPIC_CLIENT = None
_ANTHROPIC_CLIENT_KEY = None


def _anthropic_client():
    """One client per credential: rebuilt when the station enters or forgets a key."""
    global _ANTHROPIC_CLIENT, _ANTHROPIC_CLIENT_KEY
    key = RUNTIME["key"]
    if _ANTHROPIC_CLIENT is None or _ANTHROPIC_CLIENT_KEY != key:
        import anthropic  # without a station key: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
        kwargs = {"timeout": 90.0, "max_retries": 1}
        if key:
            kwargs["api_key"] = key
        _ANTHROPIC_CLIENT = anthropic.Anthropic(**kwargs)
        _ANTHROPIC_CLIENT_KEY = key
    return _ANTHROPIC_CLIENT


def anthropic_turns(messages: list) -> tuple[list, list]:
    """The Ollama-shaped message list in the Anthropic shape.

    The system prompt travels separately as a cacheable block (it is the large, stable
    part of every request), and the conversation must open with a user turn.
    """
    system = "\n\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "system")
    turns = [{"role": m["role"], "content": m["content"]}
             for m in messages if m.get("role") in ("user", "assistant") and m.get("content")]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}], turns


CLOUD_MAX_TOKENS = int(os.environ.get("COACH_CLOUD_MAX_TOKENS", "4096"))   # thinking + answer; the cost ceiling


def anthropic_stream_reply(messages: list, cap: int, emit) -> None:
    """The cloud path has no spoken-word cap (Anthony, 2026-09-03: "rethink the word cap with
    the API model"). The local cap exists because a small model ignores a length instruction
    and rambles, and a mid-sentence cut must never look like an answer. The cloud model
    follows the LENGTH guidance in the prompt; whatever complete answer it returns is
    relayed in full, and only a genuine cut-off at CLOUD_MAX_TOKENS is reported, as
    incomplete. `cap` is the guidance figure the prompt already carries."""
    system, turns = anthropic_turns(messages)
    think_scrubber = StreamScrubber()
    text_scrubber = StreamScrubber()
    spoken_out = ""
    client = _anthropic_client()
    with client.beta.messages.stream(
        model=_model(),
        max_tokens=CLOUD_MAX_TOKENS,  # thinking counts against this
        system=system,
        messages=turns,
        thinking={"type": "adaptive", "display": "summarized"},
        output_config={"effort": CLOUD_EFFORT},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",          # a policy decline re-runs on a fallback model inside the same call
    ) as stream:
        for event in stream:
            if event.type != "content_block_delta":
                continue
            delta = event.delta
            if delta.type == "thinking_delta" and delta.thinking:
                safe_think = think_scrubber.push(delta.thinking)
                if safe_think:
                    emit({"t": "think", "d": safe_think})
                continue
            if delta.type != "text_delta" or not delta.text:
                continue
            spoken_out += delta.text
            safe_text = text_scrubber.push(delta.text)
            if safe_text:
                emit({"t": "text", "d": safe_text})
        final = stream.get_final_message()
    if final.stop_reason == "refusal":
        raise CloudRefused("the cloud model declined on policy")
    if final.stop_reason not in ("end_turn", "stop_sequence"):
        raise CloudIncomplete(str(final.stop_reason))
    if not spoken_out.strip():
        raise RuntimeError("cloud stream completed without an answer")
    final_think = think_scrubber.push("", final=True)
    if final_think:
        emit({"t": "think", "d": final_think})
    final_text = text_scrubber.push("", final=True)
    if final_text:
        emit({"t": "text", "d": final_text})
    emit({"t": "done", "ok": True, "model": _model(), "reason": "stop"})


def anthropic_chat(kind: str, ask: str, projection: dict, history=None) -> tuple[bool, str, str]:
    """The non-streaming /api/advise shape, from the same streamed request."""
    cap = spoken_cap(kind)
    text_parts, think_parts = [], []

    def collect(frame):
        if frame.get("t") == "text":
            text_parts.append(frame.get("d", ""))
        elif frame.get("t") == "think":
            think_parts.append(frame.get("d", ""))

    try:
        anthropic_stream_reply(seed_messages(kind, ask, projection, history), cap, collect)
        return True, scrub("".join(text_parts)).strip(), "".join(think_parts).strip()
    except Exception as err:
        return False, _failure_message(err), ""


def injected_html() -> bytes:
    return DIST.read_bytes()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        # the request line only, with any query string dropped: a URL is never a place
        # for a credential, and the log must not become one either
        sys.stderr.write("coach: " + re.sub(r"\?[^\s\"]*", "", fmt % args) + "\n")

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _content_length(self):
        try:
            n = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return None
        return n if n >= 0 else None

    def _host_ok(self) -> bool:
        """The sidecar answers only to its own loopback name: a DNS-rebinding page that
        reaches 127.0.0.1 through some other hostname is refused on every endpoint."""
        host = (self.headers.get("Host") or "").strip().lower()
        return host in ("127.0.0.1:%d" % PORT, "localhost:%d" % PORT)

    def _read_msg(self):
        n = self._content_length()
        if n is None or n > 80000:
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

    def _same_station(self) -> bool:
        """Only the station page this sidecar serves may spend or set the credential.

        A custom header: a cross-origin page cannot send one without a CORS preflight,
        which this server never answers (OPTIONS is unsupported). And when the browser
        sends an Origin, it must be this sidecar's own loopback origin. A non-browser
        process on this machine can forge both; on a single-user loopback sidecar that
        is the accepted trust boundary, stated here rather than implied.
        """
        if self.headers.get("X-Coach-Station") != "1":
            return False
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if origin and origin not in ("http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT):
            return False
        return True

    def _credential(self) -> None:
        if not self._same_station():
            self._send(403, b'{"ok":false,"error":"station only"}', "application/json")
            return
        n = self._content_length()
        if n is None or n > 4000:
            self._send(400, b'{"ok":false,"error":"bad length"}', "application/json")
            return
        try:
            msg = json.loads((self.rfile.read(n) if n else b"{}").decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            msg = None
        if not isinstance(msg, dict):
            self._send(400, b'{"ok":false,"error":"bad json"}', "application/json")
            return
        new = dict(RUNTIME)     # committed only if every field is acceptable
        key = msg.get("key")
        if key is not None:
            key = str(key).strip()
            # printable ASCII only: a zero-width space or BOM pasted from a web page is
            # invisible to the operator and would turn a good key into a rejected one
            if len(key) < 20 or len(key) > 400 or not key.isascii() or not key.isprintable() or " " in key:
                self._send(400, b'{"ok":false,"error":"key format"}', "application/json")
                return
            new["key"] = key
            new["provider"] = "anthropic"
        if msg.get("clear"):
            new["key"] = None
            new["model"] = None
        provider = msg.get("provider")
        if provider is not None:
            provider = str(provider).strip().lower()
            if provider not in ("ollama", "anthropic"):
                self._send(400, b'{"ok":false,"error":"provider"}', "application/json")
                return
            new["provider"] = provider
        model = msg.get("model")
        if model is not None:
            model = str(model).strip()
            if model and (len(model) > 80 or not model.isascii() or not model.isprintable() or " " in model):
                self._send(400, b'{"ok":false,"error":"model format"}', "application/json")
                return
            new["model"] = model or None
        if new["provider"] == "anthropic" and not new["key"] and _fallback_credential_state() == "none":
            if msg.get("clear") and provider is None:
                new["provider"] = "ollama"      # forgetting the only credential leaves the cloud
            else:
                # Never switch PIP to a provider it cannot authenticate with, and never let
                # an "unknown" credential quietly bill somebody: refuse until a key exists.
                self._send(409, b'{"ok":false,"error":"no credential"}', "application/json")
                return
        RUNTIME.update(new)
        payload = json.dumps({"ok": True, "provider": _provider(), "model": _model(),
                              "credential": _credential_state()}).encode("utf-8")
        self._send(200, payload, "application/json")

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if not self._host_ok():
            self._send(403, b"wrong host", "text/plain")
            return
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
                "provider": _provider(),
                "model": _model(),
                "credential": _credential_state(),
                "warm": True if _provider() == "anthropic" else WARM_STATE["ready"],
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
        if not self._host_ok():
            self._send(403, b'{"ok":false,"error":"wrong host"}', "application/json")
            return
        if path in ("/api/credential", "/api/coach/credential"):
            self._credential()
            return
        # The endpoints that SPEND the credential get the same caller check as the one
        # that sets it: a simple cross-origin POST from any page open on this machine
        # must not be able to run up the operator's cloud account.
        if not self._same_station():
            self._send(403, b'{"ok":false,"error":"station only"}', "application/json")
            return
        parsed = self._read_msg()
        if parsed is None:
            self._send(400, b'{"ok":false,"error":"bad json"}', "application/json")
            return
        kind, ask, proj, hist = parsed
        if path in ("/api/advise", "/api/coach/advise"):
            chat = anthropic_chat if _provider() == "anthropic" else ollama_chat
            ok, text, thinking = chat(kind, ask, proj, hist)
            payload = json.dumps({
                "ok": ok,
                "text": text,
                "thinking": thinking,
                "model": _model() if ok else None,
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
            if _provider() == "anthropic":
                anthropic_stream_reply(messages, cap, self._emit)
            else:
                stream_reply(messages, cap, self._emit)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as err:
            if _provider() == "anthropic" and not isinstance(err, (CapExceeded, CloudRefused)):
                sys.stderr.write("coach: cloud error %s: %s\n" % (err.__class__.__name__, _redact(err)[:300]))
            try:
                self._emit({
                    "t": "err",
                    "d": _failure_message(err),
                    "reason": _failure_reason(err),
                })
            except (BrokenPipeError, ConnectionResetError):
                return


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("AI coach sidecar on http://%s:%s/  provider=%s model=%s think=%s stream=on" % (HOST, PORT, PROVIDER, MODEL, THINK))
    print("Open that URL (not the file:// dist). PIP gets one compact, trainee-safe board context per turn.")
    if WARM and _provider() == "ollama":
        threading.Thread(target=warm_local_model, name="coach-warm", daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nPIP stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
