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

(Redesign complete — all four mockup screens are real. New feature ideas
go here as numbered items.)

1. Replace scipy with hand-rolled numpy DSP to reclaim ~39MB of app size
   (the largest remaining lever — see "App size" in context.md).
   `master.py` uses exactly three scipy functions: `signal.butter`,
   `signal.filtfilt`, `signal.resample_poly`. Each is implementable in
   numpy and verifiable against scipy's output to ~1e-8 before switching
   (build the harness first; identical-output is the acceptance bar —
   this changes DSP internals, so it must not change the sound).

## Distribution

2. Real code signing + notarization (requires an Apple Developer ID
   certificate — ad-hoc signing only satisfies Gatekeeper on this machine,
   not on a build handed to someone else).
