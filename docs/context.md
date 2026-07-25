# Slopinator — context & working instructions

Read this first. [changelog.md](changelog.md) (history
+ versioning).

## What this is

I asked Claude to create a script to master audio and this is what it came up with.
I want to create a fully fledged Electron app

## Per-PR workflow (one to-do per PR)

1. `git checkout main && git pull`, then `git checkout -b feature/<name>`.
2. Implement — keep edits **surgical**.
3. Verify cheaply (see below).
4. Update [todos.md](todos.md): remove the finished item, renumber, fix any
   cross-refs.
4.5. Add a bullet under `## [Unreleased]` in [changelog.md](changelog.md) (right
   group, end with the PR number). Bump the version when cutting a release —
   see that file's "Updating per PR" / "Versioning" sections.
5. Commit (footer `Co-Authored-By: Claude {{model}} <noreply@anthropic.com>`),
   push, `gh pr create` (PR-body footer
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).
6. **Stop** — the user merges and says "continue".

## Known gotchas

- **macOS trashes Electron.app as "malware" after `npm install`.** This is
  Gatekeeper/AMFI rejecting the prebuilt Electron binary's missing/invalid
  code signature ("no CMS blob" / "Unrecoverable CT signature issue"), not
  an actual compromised package. Fix after every fresh install (the binary
  gets re-downloaded into `node_modules/electron/dist/`):
  ```bash
  xattr -cr node_modules/electron/dist/Electron.app
  codesign --deep --force --sign - node_modules/electron/dist/Electron.app
  ```
  Do this before the first `npm start` / `electron .` in a clean checkout or
  after any `npm install` that touches the `electron` package.
- **Packaged builds (`npm run pack` / `npm run dist`) hit the same Gatekeeper
  issue.** `scripts/afterSign.js` runs automatically, wired via
  electron-builder's own `build.afterSign` config in `package.json`, and
  ad-hoc re-signs the app — no manual step needed.
- **Signing must happen via electron-builder's `afterSign` hook, not a
  `postpack`/`postdist` npm script.** We shipped it as a npm post-script
  first (#6/#7) and it silently produced broken `.dmg`s: npm post-scripts
  only run after the *entire* build finishes, but electron-builder packs the
  `.app` into the `.dmg` before that — so the `.dmg` had already baked in
  the old, insufficient signature by the time the npm hook ran and re-signed
  the loose `.app` sitting next to it. Always verify a `.dmg`'s actual
  contents after touching signing (`hdiutil attach` it, `codesign -dv` the
  mounted `.app`), not just the loose build output.
- **An unsigned `master-bin` binary (PyInstaller output) is ~24s slow on its
  very first run** — that's macOS scanning its ~600 bundled dylibs, not an
  actual perf issue (subsequent runs are <1s). `afterSign.js` signs it along
  with the rest of the app (`--deep`), which avoids this for end users.
- **PyInstaller-frozen `master.py` buffers stdout fully unless explicitly
  line-buffered in the script itself** (`sys.stdout.reconfigure(line_buffering=True)`
  at the top of `main()`). Plain `python3 -u` / `PYTHONUNBUFFERED=1` don't
  reliably reach a frozen binary's stdout — this broke the live progress log
  (#4) for packaged builds until fixed directly in `master.py`.
- **electron-builder's default build-resources directory is `build/`, which
  collides with `scripts/freeze-python.sh`'s PyInstaller output
  (`build/pyinstaller*`, gitignored).** App icons etc. go in `assets/`
  instead — `package.json`'s `build.directories.buildResources` is set to
  `"assets"` to match. Don't put build resources in `build/`; they'd
  silently never get committed.

## App size (approach + facts, PR #22)

Baseline was a 311MB .app / 122MB .dmg; now 263MB / 105MB. Where the
bytes live and what was done:

- **~170MB: Electron Framework itself.** The floor for any Electron app —
  untouchable without leaving Electron.
- **54MB was Chromium locale packs** (55 × ~1.3MB `.lproj` inside
  `Electron Framework.framework`). `scripts/afterSign.js` deletes all but
  `en.lproj` before signing. Note: the `electronLanguages` option in
  `package.json` only prunes the *empty* `.lproj` stubs in the app's own
  `Contents/Resources` — it never touches the framework's real packs,
  which is why the manual prune exists.
- **75MB: the PyInstaller `master-bin`** (was 84MB). `freeze-python.sh`
  passes `--optimize 2` (strips docstrings) and `--exclude-module
  ssl/_ssl/_hashlib` — proven unused by running all three modes
  (master run, `--analyze`, `--peaks`) and checking `sys.modules`; this
  drops libcrypto+libssl (6MB). **Before adding imports to `master.py`,
  check they don't need the excluded modules** — the frozen binary will
  fail at import time if they do (always rerun all three modes on a
  packaged build after touching Python deps).
- **scipy is 39MB of master-bin and can NOT be pruned by excludes**:
  `import scipy.signal` transitively imports every heavy scipy
  subpackage (stats, optimize, sparse, spatial…) at module level —
  verified empirically. The only way to reclaim it is replacing the three
  scipy calls (`butter`, `filtfilt`, `resample_poly`) with hand-rolled
  numpy DSP, tracked as a to-do; don't waste time re-trying
  `--exclude-module scipy.*`.
- **DMG uses `format: ULFO`** (lzfse) — compresses better than the
  default.

## Token efficiency (priority)

- Don't re-read files you've seen; use `Read` with offset/limit and `grep`, not
  whole-file dumps. Never paste large network logs.
- Delegate bulk/mechanical edits to subagents; script mechanical transforms in
  bash; plan first, execute lean.
- Try to work token efficently where possible, and add new efficiencies to this doc
