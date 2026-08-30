// @artifact production
/*
 * ESS.Dispatch -- the command/event boundary (V3-PLAN section 4): "the most
 * important internal API is not REST, it is a command/event boundary."
 *
 * dispatch(ctx, {type, actor, target, payload, simTime}) validates a command,
 * routes it to a registered handler that mutates deterministic state, and
 * emits an immutable ActionEvent {seq, simTime, actor, actionType, target,
 * payload, accepted, reason?}. This is meant to become the single choke point
 * every v3 command (fault inject/clear, evidence marks, hypothesis
 * submission, drill lifecycle, snapshot restore) passes through instead of
 * mutating process/control/alarm/topology state directly. No such command is
 * wired to it yet -- that is S2 and later; this stage only builds the boundary
 * itself and proves its contract.
 *
 * THIS IS A STRANGLER SEAM, NOT A REPLACEMENT. The app already has a journal:
 * ESS.Instructor.journalAdd(I, entry) appends a plain {t, op, tag, arg, ...}
 * record and stamps entry.seq; journalText() renders any entry by `op` with a
 * graceful default for op codes it doesn't recognise; replayPlan() replays by
 * sequence/time. Dispatch does not reinvent any of that -- every entry it
 * journals keeps {op, tag, arg} in exactly that shape (op defaults to `type`,
 * tag to `target`, arg to `payload`) and only ADDS `actor`, `accepted` and
 * `reason`, so journalText and replayPlan keep working untouched on entries
 * dispatch produces, with no edit to src/instructor.js. This module never
 * requires src/instructor.js or any sibling src/*.js -- purity, and so it
 * works unbundled in the browser exactly as it does under node. The journal
 * is a collaborator, supplied by the caller as `ctx.journalAdd`, never a
 * dependency.
 *
 * KNOWN HAZARD -- thread #28, DELIBERATELY NOT FIXED IN THIS STAGE, must be
 * fixed in S2 before dispatch is wired into the app: rejections are
 * first-class here on purpose (the v3 scorer's safety gate needs to see a
 * trainee attempt something unsafe and get refused), so a refused command is
 * journaled too, marked `accepted:false` with a `reason` -- that marking is
 * the whole point, and it IS present on the entry. But
 * ESS.Instructor.replayPlan() (src/instructor.js, ~line 129) filters entries
 * ONLY on `seq` and `t` -- it has no `accepted` check. Concretely: if a
 * trainee's unsafe MODE change is refused, dispatch still journals
 * {op:'MODE', tag, arg, actor:'TRAINEE', accepted:false, reason:'...'};
 * replay does not know to skip it, and applyReplayDue -> applyJournalEntry
 * will call setMode(tag, arg) anyway, REPLAYING THE REFUSED ACTION and
 * diverging the trajectory from what actually happened. This module cannot
 * fix that (src/instructor.js is off-limits in this stage; SA is new files
 * only). tests/dispatch.test.js demonstrates this concretely against a real
 * Component/instructor, reusing the existing 'MODE' op on purpose -- the live
 * hazard is a refusal that reuses an op replayPlan already knows how to
 * re-apply, not a brand new one it would silently ignore. S2 MUST add an
 * `e.accepted !== false` guard to replayPlan's filter (or equivalently to
 * applyReplayDue) before any UI path can dispatch a command that might be
 * refused.
 *
 * The ctx contract. Dispatch itself holds no state but the handler registry
 * (see "Why a factory, not a global" below) -- everything else a handler
 * needs is supplied by the caller as `ctx`, duck-typed, never required by
 * this module:
 *   ctx.journalAdd(entry)   REQUIRED. Mutates `entry` to stamp `entry.seq`
 *                           (ESS.Instructor.journalAdd's exact contract:
 *                           entry.seq = ++I.seq, then push) and records it
 *                           wherever the caller's journal actually lives. In
 *                           the app this is `entry => ESS.Instructor.journalAdd(this.instr, entry)`;
 *                           in a unit test it can be a two-line fake.
 *   ctx.<anything else>     Whatever a registered handler's validate/apply
 *                           needs -- the tag database, the topology graph,
 *                           the seeded rng, instructor state. Dispatch never
 *                           reads these itself; only handlers do, and only
 *                           handlers know what ctx shape they require.
 *
 * Why a factory, not a global. "register(type, handler)" reads like a bare
 * module-level function, but a single mutable registry shared by every
 * caller in the process for the life of the process is exactly the kind of
 * hidden global this codebase's other pure modules avoid (topology/kpi/
 * alarm-engine are pure functions over explicit arguments; models'
 * createRand is a factory for the one piece of real state a module
 * legitimately owns). ESS.Dispatch.create() returns a fresh
 * {dispatch, register, types} bound to a private registry closure, so two
 * Components -- or two tests running in the same process -- never share
 * handlers by accident (tests/dispatch.test.js asserts this directly). The
 * app calls create() once at init and keeps the result, the same way it
 * keeps one `this.instr`.
 *
 * Registering a handler (S2 and later): dispatcher.register(TYPE, {validate,
 * apply, journal}).
 *   validate(ctx, cmd) -> true/undefined (accept), false or a string (reject,
 *     the string becomes `reason`), or {ok, reason}. May throw -- a throw is
 *     treated as a rejection, never propagated: one broken handler must not
 *     take down a training session already in progress.
 *   apply(ctx, cmd) -> mutates state via ctx; whatever it returns is passed
 *     to `journal` as `applyResult`. May throw, likewise turned into a
 *     rejected ActionEvent (reason records the message) rather than
 *     propagating.
 *     CONTRACT, NOT ENFORCED (found in adversarial review of this stage):
 *     dispatch has no rollback. If apply() mutates ctx and THEN throws, the
 *     mutation stands even though the resulting event says accepted:false --
 *     a throw here is treated as equivalent to a validate() rejection for
 *     event-shape purposes only, NOT for the "a rejected command has no
 *     effect" invariant the rest of this module (and tests/dispatch.test.js)
 *     otherwise upholds. A handler MUST therefore do every check that can
 *     fail inside validate(), and write apply() as a mutation that, once
 *     started, cannot itself fail -- never "mutate a little, then maybe
 *     throw". tests/dispatch.test.js demonstrates the leak concretely.
 *   journal(ctx, cmd, applyResult) -> optional {op?, tag?, arg?, ...} to
 *     shape the legacy entry beyond the default op=type/tag=target/
 *     arg=payload; any other keys are copied onto the entry as extra fields
 *     (the existing convention -- e.g. {cond} on an alarm entry). Only
 *     consulted on the ACCEPTED path, since nothing ran to describe on a
 *     rejected one. `t`, `actor`, `accepted`, `reason` and `seq` in whatever
 *     `journal` returns are ignored -- dispatch itself owns those fields on
 *     every entry unconditionally, so a careless handler can never blur an
 *     acceptance into the safety-relevant part of the record.
 *
 * TYPES lists the type names later stages are expected to register
 * (FAULT_INJECT, FAULT_CLEAR, ...) as frozen string constants so callers
 * don't typo them. Dispatch ships with NO handlers registered for any of
 * them here -- dispatching one today is a legitimate, well-formed rejection,
 * "no handler registered for type FAULT_INJECT", exactly like any other
 * unknown type. Registering the real behaviour is later stages' job.
 *
 * Purity: no DOM, no timers, no globals, no sibling src/*.js require. Pure
 * UMD -- browser global under ESS.Dispatch, `module.exports` under node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.ESS = root.ESS || {}).Dispatch = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ACTORS = Object.freeze(['TRAINEE', 'INSTRUCTOR', 'SYSTEM', 'ASSISTANT']);

  // Reserved for later stages (V3-PLAN sections 4 and 8). No handler is
  // registered for any of these by this module -- they are names, not yet
  // behaviour. S2/S3/S4 register real handlers under these exact strings.
  var TYPES = Object.freeze({
    FAULT_INJECT: 'FAULT_INJECT',
    FAULT_CLEAR: 'FAULT_CLEAR',
    MARK_EVIDENCE: 'MARK_EVIDENCE',
    PIN_COMPARE: 'PIN_COMPARE',
    SUBMIT_HYPOTHESIS: 'SUBMIT_HYPOTHESIS',
    DRILL_START: 'DRILL_START',
    DRILL_END: 'DRILL_END',
    SNAPSHOT_RESTORE: 'SNAPSHOT_RESTORE'
  });

  function errMsg(err) { return (err && err.message) ? err.message : String(err); }

  /** Normalize whatever a handler's validate() returned into {ok, reason}. */
  function normalizeValidation(v) {
    if (v === undefined || v === true) return { ok: true, reason: null };
    if (v === false) return { ok: false, reason: 'rejected' };
    if (typeof v === 'string') return { ok: false, reason: v };
    if (v && typeof v === 'object') return { ok: !!v.ok, reason: v.reason || (v.ok ? null : 'rejected') };
    return { ok: true, reason: null };
  }

  function createRegistry() {
    var handlers = Object.create(null);
    return {
      register: function (type, def) {
        if (typeof type !== 'string' || !type) {
          throw new Error('ESS.Dispatch.register: type must be a non-empty string');
        }
        def = def || {};
        if (def.validate !== undefined && typeof def.validate !== 'function') {
          throw new Error('ESS.Dispatch.register(' + type + '): validate must be a function when provided');
        }
        if (def.apply !== undefined && typeof def.apply !== 'function') {
          throw new Error('ESS.Dispatch.register(' + type + '): apply must be a function when provided');
        }
        if (def.journal !== undefined && typeof def.journal !== 'function') {
          throw new Error('ESS.Dispatch.register(' + type + '): journal must be a function when provided');
        }
        handlers[type] = {
          validate: typeof def.validate === 'function' ? def.validate : null,
          apply: typeof def.apply === 'function' ? def.apply : function () { return undefined; },
          journal: typeof def.journal === 'function' ? def.journal : null
        };
      },
      get: function (type) {
        return Object.prototype.hasOwnProperty.call(handlers, type) ? handlers[type] : null;
      },
      types: function () { return Object.keys(handlers).sort(); }
    };
  }

  /** The {op,tag,arg} portion of a legacy journal entry -- the CRITICAL DESIGN
   *  CONSTRAINT shape, kept intact so journalText/replayPlan need no change. */
  function baseEntryFields(type, target, payload) {
    return { op: type, tag: target || '', arg: payload == null ? '' : payload };
  }

  var PROTECTED_KEYS = { op: 1, tag: 1, arg: 1, t: 1, actor: 1, accepted: 1, reason: 1, seq: 1 };

  function create() {
    var registry = createRegistry();

    function dispatch(ctx, cmd) {
      if (!ctx || typeof ctx.journalAdd !== 'function') {
        throw new Error('ESS.Dispatch.dispatch: ctx.journalAdd(entry) function is required');
      }
      cmd = cmd || {};
      var type = cmd.type;
      var actor = cmd.actor;
      var target = cmd.target === undefined ? null : cmd.target;
      var payload = cmd.payload === undefined ? null : cmd.payload;
      var simTime = cmd.simTime;

      var accepted = true;
      var reason = null;
      var handler = null;

      if (ACTORS.indexOf(actor) < 0) {
        accepted = false;
        reason = 'unknown actor: ' + String(actor);
      } else {
        handler = registry.get(type);
        if (!handler) {
          accepted = false;
          reason = 'no handler registered for type: ' + String(type);
        } else {
          var vr;
          try {
            vr = normalizeValidation(handler.validate ? handler.validate(ctx, cmd) : true);
          } catch (err) {
            vr = { ok: false, reason: 'validate threw: ' + errMsg(err) };
          }
          if (!vr.ok) { accepted = false; reason = vr.reason || 'rejected'; }
        }
      }

      var entry = null;
      if (accepted) {
        var applyResult;
        try {
          applyResult = handler.apply(ctx, cmd);
        } catch (err) {
          accepted = false;
          reason = 'apply threw: ' + errMsg(err);
        }
        if (accepted) {
          var custom = null;
          if (handler.journal) {
            try { custom = handler.journal(ctx, cmd, applyResult); }
            catch (err) { custom = null; } // a broken journal() formatter falls back to the default shape
          }
          entry = baseEntryFields(type, target, payload);
          if (custom && typeof custom === 'object') {
            if (custom.op !== undefined) entry.op = custom.op;
            if (custom.tag !== undefined) entry.tag = custom.tag;
            if (custom.arg !== undefined) entry.arg = custom.arg;
            Object.keys(custom).forEach(function (k) {
              if (PROTECTED_KEYS[k]) return; // a handler cannot blur the safety-relevant fields
              entry[k] = custom[k];
            });
          }
        }
      }
      if (!accepted) {
        entry = baseEntryFields(type, target, payload);
      }

      // Dispatch owns these on every entry, accepted or not -- no handler input reaches them.
      entry.t = simTime;
      entry.actor = actor;
      entry.accepted = accepted;
      if (!accepted) entry.reason = reason;

      ctx.journalAdd(entry); // mutates entry.seq in place -- the ONE shared sequence space

      var event = {
        seq: entry.seq,
        simTime: simTime,
        actor: actor,
        actionType: type,
        target: target,
        payload: payload,
        accepted: accepted
      };
      if (!accepted) event.reason = reason;
      return Object.freeze(event);
    }

    return {
      register: registry.register,
      types: registry.types,
      dispatch: dispatch
    };
  }

  return { create: create, ACTORS: ACTORS, TYPES: TYPES };
});
