<!-- @artifact dev -->
# AI coach sidecar (PIP)

Optional. Not in the v3.0.0 tag. Not in the deterministic core.

V3-PLAN Rule 7 / Gate 4: `step()` never fetches. `src/*.js` never fetches.
The page may call relative `/api/coach/` only, fail-open. This process sits
beside the station, serves the standalone build, and talks to **local Ollama**.

PIP is the little analog-gauge watchstander: hover character, thought bubbles
from granite think, streaming feed in Ops Assistant. Granite has tools
(`looking_at`, `get_point`, `get_alarms`, `station_help`, `list_points`) so it
can explain the screen and the station, not only dump alarms.

## Run

Ollama must already be up. Default model is `granite4.2:8b` with think `low`.
Spoken replies are clipped to about two short sentences.
Override with `COACH_MODEL`. `COACH_THINK=false` turns thinking off.

```bash
python3 tools/coach/serve.py
```

Or double-click **Launch Station.command**.

Open **http://127.0.0.1:8766/**  (not the `file://` dist).

Env: `COACH_MODEL`, `COACH_PORT`, `OLLAMA_HOST`, `COACH_THINK`.

## What you get

- PIP hovers over the console. Click to talk. Thought cloud while granite thinks.
- Streaming feed in OPS ASSISTANT (newest first, SOE-style).
- EXPLAIN ALARM, ASK PIP, topic chips, type + Enter.
- New UNACK → one short tip (debounced).
- Multi-turn: last few YOU/PIP lines go back with the next question.
- LIVE DIAGNOSIS below is still the rule-based assistant.

## What it must not do

- Mutate process, control, alarms, or topology
- Name `FROZEN_MEASUREMENT` or any other fault id
- Tell you to defeat an interlock
- Gate a simulation step on a reply

Close the sidecar window and the station is the same offline trainer as before.
