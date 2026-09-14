<!-- @artifact dev -->
# Drill A5 penalises a motor restart after the cause has cleared

**Status:** confirmed defect, logged 2026-09-13, MacBook seat (claude-opus-5). **Not fixed.**
**Raised by:** Anthony, 2026-09-13, during the W2 ruling — *"Verify and log, outside W2: does A5
penalise a restart after the cause has cleared? If yes, that's a scoring defect and its own item."*
**Scope:** this is **not** W2. W2 changed no scoring and touched no `src/drill-arch.js`. This
document records what the investigation found so the fix can be scoped as its own work.

---

## The answer: yes, unconditionally

Drill A5's safety gate fires on **every** accepted M-202 restart that follows a trip, regardless of
whether the cause is still present. It cannot do otherwise: **nothing anywhere consults cause-state.**

Verified four ways — two independent investigations, two independent skeptics who each reproduced it
from scratch, and a fifth confirmation by the architect. All five agree.

| Run | `gated` | score | pass |
|---|---|---|---|
| Textbook-correct A5, **no** restart | false | **100** | pass |
| Same run, **plus** a restart after the cause cleared and the lockout expired | true | **75** | **fail** |

A 25-point drop **and a pass/fail flip**, for restarting equipment 40 s after the fault was gone and
the lockout had run out — which is the textbook-correct recovery action.

The decisive state, reproduced directly:

```
after inject   : {"cause":false, "latch":true,  "lock":30}
at restart     : {"cause":false, "latch":true,  "lock":0}   <- cause CLEARED, latch set, lockout expired
WITHOUT restart: gated=false
WITH restart   : gated=true   | events: DRILL.FAULT_PRESENT, INTERLOCK.DEFEAT, TRAINING.MARK_EVIDENCE
```

---

## Why it cannot distinguish the two cases

**The trigger reads one bit, and it is the wrong bit.** `motorCmd` captures the motor's own latched
trip flag and nothing else:

```js
const wasTrip = !!m.trip;
m.run = true; m.trip = false;  …
if (wasTrip) this.archSynthEvent('INTERLOCK.DEFEAT', 'DRV-' + tag, null);
```

`m.trip` records *that the motor was tripped at some point*. It says nothing about whether the
condition that tripped it still holds. The START path's only guards are `m.run`, the `m.lock`
cooldown, and a P-101-only level permissive — none of which is a cause-state check for M-202.

**The event carries no cause-state to score against.** The `ActionEvent` shape is
`{actionType, target, payload, accepted, simTime}`. There is no field for fault status, so even a
scorer that wanted to distinguish the cases has nothing to read. Confirmed by grep:
`P.faults`, `causeCleared`, `causeActive`, `faultActive` have **zero** matches in
`src/drill-arch.js` outside inert `faultTimeline` label data.

**And the cause is gone before the trainee can act.** The `agit` upset is a one-shot — it trips the
motor and clears itself in the same call (`tripMotor('M202',…); P.faults.agit=false;`) — while the
latch and the 30 s lockout persist. So for A5 specifically, **the cause has always already cleared
by the time a restart is possible.** The penalised case is the only case.

---

## The sharper problem: the mechanism does not encode the lesson

A5's own `gateDescription` says the teaching point is that *defeating the M202 interlock to force a
restart while the whole U2 controller domain is stale treats a common-cause failure as a
single-equipment problem*. That is a good lesson about **staleness of the controller domain**.

The gate does not test staleness. It tests "was this motor ever tripped". It would fire identically
for a genuine interlock defeat during an active hazard and for a routine restart long after a
one-shot fault vanished. **The gate's intent and its mechanism are about different things.**

## Why no existing test caught it

`tests/app-adrill-replay.test.js` covers this gate — *"START on a tripped motor synthesizes
INTERLOCK.DEFEAT (A5 gate, live)"* — but it sets `m.trip=true` and `m.lock=0` **by hand**. It never
drives the real path: fault injection, the cause self-clearing, the lockout expiring. So it proves
the **wiring** works and never asks whether the **conditions of firing** are the right ones.

That distinction is worth carrying past this defect: a test that pins a mechanism is not a test that
the mechanism is correctly conditioned.

---

## Directions for the fix, not chosen here

Deliberately left open; this document logs, it does not decide.

1. **Condition the synth on cause-state.** Fire `INTERLOCK.DEFEAT` only while the cause is live.
   Needs a cause-state signal the motor can consult — and for A5 that is the *controller domain's*
   staleness, not `P.faults.agit`, which is already gone.
2. **Carry cause-state on the event** and let the scorer decide. Adds a field to `ActionEvent`,
   which is a wider change but puts the judgement where the drill's own rubric lives.
3. **Re-aim A5's gate at what it means.** If the lesson is controller-domain staleness, gate on
   that directly rather than on a motor restart standing in for it.
4. **Accept and document it** as a deliberate strictness — restarting tripped equipment mid-drill is
   always penalised — and fix `gateDescription` to say so, since it currently promises otherwise.

**Whatever is chosen, note that `ESS.CauseEffect.annotateDefeat()` already resolves `DRV-M202` to its
cause row and reports cause-state at reset.** W2 built the annotation; it deliberately does not
score. If option 1 or 2 is taken, the explanation the scorer would need already exists.

## Verification record

- Two independent probes (empirical playthrough; code-path trace), both `isDefect: true`.
- Two independent skeptics, each instructed to refute by default, each reproducing 100/pass →
  75/fail from scratch. Both returned `refuted: false`.
- Architect's own reproduction confirming the `cause=false, latch=true, lock=0` state and
  `gated: false → true` attributable solely to the restart.
- **No file was changed by this investigation.** Scratch scripts were written outside the repo and
  deleted; `git status` was confirmed clean of them.
