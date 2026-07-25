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

## Token efficiency (priority)

- Don't re-read files you've seen; use `Read` with offset/limit and `grep`, not
  whole-file dumps. Never paste large network logs.
- Delegate bulk/mechanical edits to subagents; script mechanical transforms in
  bash; plan first, execute lean.
- Try to work token efficently where possible, and add new efficiencies to this doc
