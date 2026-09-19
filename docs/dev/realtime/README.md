<!-- @artifact dev -->
# Governed live operations

PEB consumes a self-contained copy built with `python3 tools/rt/build-artifact.py OUTPUT`.
Run `python3 tools/build-dist.py` first. The artifact pins source bytes, prepared
checkpoint, generated standalone station and Node major/minor runtime. No production
path evaluates the HTML or imports the test logic harness.

`extracted-methods.json` inventories the statically shared native methods.
`PlantKernel` checkpoints P/L/V, both RNGs, alarm engine, complete fault schedules,
phase/interlock latches, bounded trends, instructor/replay and exercise state,
message IDs, cause/effect deduplication, revisions, attention and product totals.
RT history keeps the most recent five minutes; full replay reconstructs longer
trajectories. Standalone keeps its existing history and local clock.

`?rt=1` requires the authenticated PEB parent. It has no local simulation timer.
Commands are intents; only the next committed parent snapshot changes the process.
The PEB worktree `/private/tmp/peb-live-coordinator/docs/realtime/README.md` contains
launch, credential, ownership, review, export and commissioning instructions.
