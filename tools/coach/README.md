<!-- @artifact dev -->
# AI coach sidecar

Optional. Not in v3.0.0. Not in the deterministic core.

V3-PLAN Rule 7 / Gate 4: the station never fetches, never waits on a model.
This process sits beside it. It serves a copy of the standalone build, injects
a panel, and asks a **local Ollama** model to explain alarms or give a short
tip. Hidden instructor fault ids are stripped from the prompt inputs (they are
never sent) and from the model text if it invents one.

## Run

Ollama must already be up. Default model is `granite4.2:8b` (think off for
tips). Override with `COACH_MODEL`.

```bash
python3 tools/coach/serve.py
```

Open **http://127.0.0.1:8766/**  (not the `file://` dist).

Env: `COACH_MODEL`, `COACH_PORT`, `OLLAMA_HOST`.

## What you get

The **Ops Assistant** column **is** the coach when you use Launch Station.command.
COACH at the top talks to local granite. LIVE DIAGNOSIS below is rule-based and
always on. The page calls relative `/api/coach/` only, fail-open, never from
`step()`. Opening the raw html stays offline.

- New UNACK alarm → one short tip (debounced)
- **EXPLAIN ALARM** → selected alarm, or the worst active one
- Type in ASK ABOUT A PROBLEM, then **ASK AI**
- System prompt: `tools/coach/prompt.txt`

The existing Ops Assistant (rule-based LIVE DIAGNOSIS) is unchanged.

## What it must not do

- Mutate process, control, alarms, or topology
- Name `FROZEN_MEASUREMENT` or any other fault id
- Tell you to defeat an interlock
- Gate a simulation step on a reply

Close the sidecar window and the station is the same offline trainer as before.
