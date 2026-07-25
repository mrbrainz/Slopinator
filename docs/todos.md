# To-dos

One item = one PR. Remove the finished item and renumber when done (see
[context.md](context.md) workflow).

1. Build a minimal UI: file picker for input, output path, format preset
   dropdown, "Master" button.
2. Wire the UI to `master.py` via a child process (or port the chain to
   Node/WASM if we want to drop the Python dependency).
3. Show mastering progress / logs in the UI instead of stdout.
4. Add drag-and-drop for batch mode (drop a folder of tracks onto the app).
5. Package/sign a distributable build (macOS first, per current dev
   environment).
