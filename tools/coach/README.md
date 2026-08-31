<!-- @artifact dev -->
# AI coach sidecar (PIP)

Optional. Not in the v3.0.0 tag. Not in the deterministic core.

V3-PLAN Rule 7 / Gate 4: `step()` never fetches. `src/*.js` never fetches.
The page may call relative `/api/coach/` only, fail-open. This process sits
beside the station, serves the standalone build, and talks to **local Ollama**.

PIP is the little analog-gauge watchstander: hover character, live token stream
in Ops Assistant, and a compact trainee-safe board context selected by the
sidecar. Normal turns are one model pass—there is no blocking tool round-trip
before PIP starts talking.

## Run

Ollama must already be up. Default model is `granite4:1b` with thinking off,
which is much lighter than the original 8.8B coach and starts streaming sooner.
Override with `COACH_MODEL=granite4.2:8b` for the larger model or set
`COACH_THINK=low` if the selected model supports thinking.

```bash
python3 tools/coach/serve.py
```

Or double-click **Launch Station.command**.

Open **http://127.0.0.1:8766/**  (not the `file://` dist).

Env: `COACH_MODEL`, `COACH_PORT`, `OLLAMA_HOST`, `COACH_THINK`.

## What you get

- PIP hovers over the console. Click to talk.
- Spoken tokens stream into OPS ASSISTANT as they arrive (newest first, SOE-style).
- EXPLAIN ALARM, ASK PIP, topic chips, type + Enter.
- Related new UNACK alarms settle into one episode before PIP gives one short tip;
  manual questions take priority and suppress background chatter for 30 seconds.
- Multi-turn: last few YOU/PIP lines go back with the next question.
- LIVE DIAGNOSIS below is still the rule-based assistant.

## What it must not do

- Mutate process, control, alarms, or topology
- Name `FROZEN_MEASUREMENT` or any other fault id
- Tell you to defeat an interlock
- Gate a simulation step on a reply

Close the sidecar window and the station is the same offline trainer as before.
