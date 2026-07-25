# Changelog

All notable changes to this project are documented here. Format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

### Added
- Electron project scaffold: main process, preload, minimal renderer, and
  electron-builder packaging config alongside the existing `master.py`
  chain (#1)
- Mastering UI: input/output file pickers, loudness preset dropdown, and a
  "Master" button (not yet wired to `master.py`) (#2)
- Wired the Master button to `master.py` via a spawned child process; app
  auto-detects a project-local `.venv/bin/python3` if present, falling back
  to plain `python3` (#3)

### Changed
- README setup instructions now use a `.venv` instead of a global
  `pip install`, since Homebrew Python blocks global installs (#3)

### Fixed

## [0.1.0] - 2026-07-25

### Added
- Initial mastering chain: corrective EQ, mono bass, saturation, loudness
  normalization, true-peak limiter, dither on export.
- Loudness presets (`streaming`, `soundcloud`, `club`) and batch mode.

## Updating per PR

Add a bullet under `## [Unreleased]`, in the group matching the change type
(`Added` / `Changed` / `Fixed` / `Removed`), ending with the PR number, e.g.:

```
### Added
- Electron window shell wrapping the CLI mastering chain (#4)
```

Delete empty group headers when the section is otherwise empty; leave the
group headers under `[Unreleased]` in place (even empty) between PRs so the
next PR has somewhere to add its bullet.

## Versioning

Bump the version when cutting a release, not per-PR:

- **Patch** (`0.1.x`) — bug fixes only.
- **Minor** (`0.x.0`) — new features, backwards-compatible.
- **Major** (`x.0.0`) — breaking changes (e.g. CLI flag removal, output
  format changes).

To cut a release: rename `[Unreleased]` to the new version + today's date,
then add a fresh empty `[Unreleased]` section above it with the three group
headers.
