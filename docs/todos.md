# To-dos

One item = one PR. Remove the finished item and renumber when done (see
[context.md](context.md) workflow).

## Redesign toward docs/design/mockup.html ("Chain")

Target is the 4-screen mockup at [design/mockup.html](design/mockup.html)
(Library / Chain view / Compare / Export). Sequenced so foundational
capabilities land before the screens that depend on them. Two things in the
mockup are scoped down from how they're drawn, since the underlying
capability doesn't really support them as-is:
- Export's mid-file progress bar → stepped (queued/rendering/done), not a
  smooth percentage — `master.py` has no progress reporting mid-file.
- The meter ladder → shows the *final* measured values after a run
  completes, not true real-time metering during processing.

1. Save/reuse named chain presets ("Save presets used" in the mockup) —
   extend `src/main/library.js`'s store to remember a named parameter set a
   user can reapply to other tracks. Chain view's `params` object
   (`src/renderer/chain-view.js`) is the natural shape to snapshot/restore.
   The Export screen deliberately shipped without this button — add it
   there (and in Chain view) once presets exist.

## Distribution

2. Real code signing + notarization (requires an Apple Developer ID
   certificate — ad-hoc signing only satisfies Gatekeeper on this machine,
   not on a build handed to someone else).
