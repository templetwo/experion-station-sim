<!-- @artifact dev -->
# Demo checklist — putting the board in front of veteran operators

Written 2026-09-03 after the readiness pass. Everything here was exercised in a real
browser against the sidecar on this MacBook; the numbers are measured, not guessed.

## The night before

1. **Pull `v3`** on the demo machine and run the three checks once:
   `node --test tests/*.test.js` (green, one skipped), `python3 tools/build-dist.py`,
   `tools/smoke.sh`. The sidecar serves `dist/`, so the build is what the room sees.
2. **Kill any sidecar already running** (`lsof -ti:8766 -sTCP:LISTEN | xargs kill`). A
   sidecar started before today's code serves yesterday's coach.
3. **Decide the coach model.** The default (`COACH_PROVIDER=auto`) is the cloud whenever a
   credential exists and the local model otherwise; a question the cloud refuses before
   answering (no credits, no network) is answered by the local model and logged. The
   launcher prints which it resolved to.
   - Local, no network: `COACH_MODEL=granite4.2:8b python3 tools/coach/launch.py`
     (the 1B default answers in ~6 s and gets the physics right; the 8B is measurably
     better on judgment and answers in 9–15 s once warm). The sidecar loads the model at
     startup and the page shows **LOADING** until `coach: model … warm in N s` appears in
     the terminal — about 7 s for the 8B when Ollama already has it on disk, minutes if
     it has to be pulled. Do this before the operators sit down.
   - Cloud: the org needs API credits. Then either `COACH_PROVIDER=anthropic` on the
     launch line (credentials from `ant auth login` or `ANTHROPIC_API_KEY`), or launch
     local and enter the key at the station: Help → *PIP cloud credential…* (command
     `CLOUDKEY`, SUPV or above). Each question costs on the order of a cent or two.
4. **Read the orientation document yourself** (command `PROCESS`). It is the plant's
   story; PIP reads the same text. If a sentence is wrong, fix `src/process.js` — the
   gate `tests/process-text.test.js` keeps its tags and numbers honest, not its judgment.

## In the room

- Open with `PROCESS`: what the plant makes, the route, the four things that bite.
- The three orientation chips on the Ops Assistant answer from the document.
- Drills → D1 CANONICAL: the FIC102 transmitter fails ~20 s in. LIVE DIAGNOSIS names the
  bad PV; EXPLAIN ALARM now carries that alarm's rationalised help to the coach, and the
  8B model says the measurement is bad and the feed is not necessarily low.
- Ask PIP "Is E-301 a cooler or a heater?" — preheater on hot oil, every surface agrees.
- Instructor (`INSTR`, password `instr`): snapshot, act, REPLAY — the replay reproduces
  the trajectory exactly, including a canonical drill start.

## Say this before they find it

- Three units. Unit 04 (separation, recycle, purge) and the stabilizer are designed
  (`docs/dev/P2L-EXPANSION-SPEC.md`) and not built. The document's last section lists
  what is not simulated; say it first.
- PIP is advisory and reads only what is on the board. LIVE DIAGNOSIS is rule-based and
  always right about what it says.
- No property package, no flash solver, no compressor surge. Trip points are this
  simulator's own.

## Security levels (training defaults, also in Help)

`oper`, `supv`, `engr`, `mngr`; instructor station `instr`. The cloud-key dialog and the
colour philosophy need SUPV; tuning and trip points need ENGR with a signature.
