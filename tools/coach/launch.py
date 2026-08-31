#!/usr/bin/env python3
# @artifact dev
"""One launch: operator station + local AI coach in the same window.

Double-click Launch Station.command in the repo root, or:

  python3 tools/coach/launch.py

Opens http://127.0.0.1:8766/  Leave this process running.
The raw .html file stays offline on purpose (Gate 4). This is the
together path.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PORT = int(os.environ.get("COACH_PORT", "8766"))
MODEL = os.environ.get("COACH_MODEL", "granite4:1b")
HOST = "127.0.0.1"
BASE = "http://%s:%s" % (HOST, PORT)
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")


def get(url: str, timeout: float = 1.5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def coach_health():
    return get(BASE + "/api/health", timeout=1)


def main() -> int:
    print("Operator station + AI coach")
    print("  model  %s" % MODEL)
    print("  url    %s/" % BASE)

    tags = get(OLLAMA.rstrip("/") + "/api/tags", timeout=2)
    if not tags:
        print("Ollama is not running. Start it, then:")
        print("  ollama pull %s" % MODEL)
        print("  python3 tools/coach/launch.py")
        return 1
    names = [m.get("name", "") for m in tags.get("models", [])]
    if MODEL not in names and not any(n.startswith(MODEL) for n in names):
        print("Model %s is not pulled. Run:" % MODEL)
        print("  ollama pull %s" % MODEL)
        return 1

    child = None
    health = coach_health()
    if not health:
        env = os.environ.copy()
        env["COACH_MODEL"] = MODEL
        env["COACH_PORT"] = str(PORT)
        child = subprocess.Popen(
            [sys.executable, str(ROOT / "tools" / "coach" / "serve.py")],
            cwd=str(ROOT),
            env=env,
        )
        for _ in range(40):
            time.sleep(0.15)
            health = coach_health()
            if health:
                break
        if not health:
            print("Coach sidecar failed to start on %s" % BASE)
            if child.poll() is None:
                child.terminate()
            return 1
    print("  sidecar ready (%s)" % (health.get("model") if health else MODEL))

    opened = webbrowser.open(BASE + "/")
    if not opened:
        print("Could not open a browser. Open this yourself:")
        print("  %s/" % BASE)
    else:
        print("Browser should open. Leave this terminal open while you train.")
        print("PIP hovers on the board. Click PIP, EXPLAIN ALARM, or just talk.")

    if child is not None:
        try:
            return child.wait()
        except KeyboardInterrupt:
            child.terminate()
            print("\nCoach stopped.")
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
