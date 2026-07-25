# To-dos

One item = one PR. Remove the finished item and renumber when done (see
[context.md](context.md) workflow).

1. Set up Electron project scaffold (main + renderer process, packaging
   config) alongside the existing `master.py` chain.
2. Build a minimal UI: file picker for input, output path, format preset
   dropdown, "Master" button.
3. Wire the UI to `master.py` via a child process (or port the chain to
   Node/WASM if we want to drop the Python dependency).
4. Show mastering progress / logs in the UI instead of stdout.
5. Add drag-and-drop for batch mode (drop a folder of tracks onto the app).
6. Package/sign a distributable build (macOS first, per current dev
   environment).
