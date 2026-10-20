# Editing a hook

Hooks run in a maintainer's own session with their credentials, on every matching tool call.

- Resolve paths against the **git worktree root**, not `CLAUDE_PROJECT_DIR` — `/implement-ticket`
  works in a worktree by default. Use `worktreeRoot()` in `hooks/lib/workflow-config.mjs`, the one
  place that decides this.
- **Never break a session on bad input.** `loadConfig()` returns `{}` for a missing or malformed
  `workflow.json`. `readInput()` returns `null` on anything unparseable. An un-onboarded repo must
  stay usable.
- A blocking hook risks a false positive that costs someone a working session.
  `block-wrong-bash` has already inverted once against the exact cross-repo shape it exists to
  permit (#16). Test the session shapes, not just the happy path.
