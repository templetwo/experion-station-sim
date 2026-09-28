<!-- @artifact dev -->
# Live relief event localization amendment

Declared 2026-09-28 before implementing the replacement event algorithm.
The initial live recipe at `ddde5bf` uses a 0.0625 s maximum material substep
and checks the relief latch only at substep boundaries. Its new independent
SciPy comparison found 7 of 8 probes within the declared limits. Repeated
closed-normal-vent relief cycles failed: approximately 28.30 kPa maximum
pressure error and 1.95 s event drift, despite conserved mass and matching
event order. The first discrete reseat undershot 1000 kPa; filling that extra
mass deficit delayed the next lift. This numerical failure is retained as its
own receipt with source/recipe bytes. It is not validated by the live
consequence test, which only establishes that relief actually operates.

The prospective [v2 recipe](../../tools/g2-live/recipe-v2.json) retains every
physical parameter, domain and comparison tolerance. It changes only the
solver event rule:

1. Keep the declared equal RK4 outer substeps and reaction-rate refinement.
2. Bracket a lift/reseat crossing inside a substep using its trial endpoint.
3. Run exactly 32 bisections from the unchanged start vector to locate the
   first bracket endpoint satisfying the threshold. Use strict below-1000
   reseating and at-or-above-1100 lifting.
4. Advance every inventory, generation and transfer counter to that time;
   switch the latch and integrate the remaining time with the new vent state.
   No pressure clipping, mass projection or counter correction is permitted.
5. Cap events at 64 per frame; exceeding it fails the whole transactional scan.

The old recipe, failed source and failed receipt remain reproducible. A new
receipt must evaluate the replacement against the same event-aware reference
and unchanged tolerances, plus continuity, closure, startup and checkpoint
cases. Installing v2 updates the material recipe identity; it does not make
v1 snapshots compatible by inference. The composition quantity schema stays
`composition_mass_v1` because inventory and accounting meanings are unchanged.

This repairs a numerical defect within the authorized integration. It opens
no hydraulics, cooling, reaction-energy, MOA, licence or publication scope.
