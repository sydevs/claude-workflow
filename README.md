# claude-workflow

The shared [Claude Code](https://claude.com/claude-code) workflow for the
[sydevs](https://github.com/sydevs) projects — one issue-to-PR pipeline used by
**SahajCloud**, **SahajAtlasWeb**, **WeMeditateWeb** and **SahajAtlasWordpress**.

## Why this exists

These four repositories are developed in tandem, and for a while they each carried their own copy
of the same workflow skills, kept in sync by hand against a spec that required the copies stay
byte-identical. They did not. By the time this plugin was written the copies had diverged by
90–250 lines apiece, pipeline steps had been renamed between them, and the audit meant to catch the
drift had been comparing against a directory that no longer existed.

The problem was never discipline — it was that prose in triplicate has no enforcement. So the
per-repo differences are no longer prose. They live in one `.claude/workflow.json` per repo, and
there is exactly one copy of each skill.

## Install

```bash
/plugin marketplace add sydevs/claude-workflow
/plugin install workflow@sydevs
```

Each repo also declares it in `.claude/settings.json`, so a fresh clone picks up the marketplace
after the folder is trusted:

```json
{
  "extraKnownMarketplaces": {
    "sydevs": { "source": { "source": "github", "repo": "sydevs/claude-workflow" } }
  },
  "enabledPlugins": ["workflow@sydevs"]
}
```

Project settings register the marketplace but do not auto-install an external-source plugin, so
each person runs `claude plugin install` once.

## What it provides

| Skill | Purpose |
| --- | --- |
| `/workflow:draft-ticket` | Draft a GitHub issue — clarify ambiguity first, then acceptance criteria and a verification checklist. The issue is the spec. |
| `/workflow:implement-issue` | Implement an issue in a worktree, gated by the repo's autonomy allowlist, then ship via `finalize-pr`. |
| `/workflow:finalize-pr` | Simplify → review → conditional security review → lean gate → docs sync → push → PR → capped CI loop. |
| `/workflow:cross-repo-issue` | File a change spanning repos as a tracking issue plus linked children, in dependency order. |
| `/workflow:dev-server` | One dev server per **git worktree**, with its own port and its own database. |

Plus four hooks: `block-generated-files`, `block-wrong-bash`, `prettier-format`, `eslint-fix`.

## Configuration

Everything repo-specific comes from `<repo>/.claude/workflow.json`:

| Key | Meaning |
| --- | --- |
| `packageManager` | Used by the hooks and any constructed command. |
| `leanGate.command` / `.full` | The pre-PR test gate. |
| `contractStep` | Migrations, `types:cms`, or the URL-contract diff. |
| `securityReview.triggerPattern` | Paths that trigger a branch-level security review. |
| `securityReview.contentPattern` / `.contentPaths` | Newly-introduced sinks, regardless of path. |
| `prAllowlistGlobs` | The autonomy gate — where an automated run may open a draft PR rather than filing an issue. |
| `generatedFiles` | `{ pattern, reason }` rules for `block-generated-files`. |
| `worktreeSetup` | Commands run after `EnterWorktree`. |
| `devServer` | `command`, `basePort`, `healthPath`, and optional database isolation. |

## Deliberately not here

Several things were dropped rather than ported, because something maintained elsewhere already
covers them:

- **Code review** → the official `pr-review-toolkit` plugin (six specialist agents with confidence
  scores) instead of a single hand-rolled pass.
- **Security review** → the built-in `/security-review` plus the official `security-guidance`
  plugin, which catches issues at edit time.
- **Type checking on edit** → the official `typescript-lsp` / `php-lsp` plugins. A language server
  reports diagnostics in the same turn as the edit; the old `typecheck` hook could not.
- **Session reflection** → the official `claude-md-management` plugin.
- **`pr-prep` skill** → `workflow.json.leanGate` pointing at each repo's own `check.sh`. The skill
  was a wrapper that added nothing.

`prettier-format` and `eslint-fix` survive because they *rewrite* files, which no language server
does.

## Development

```bash
claude --plugin-dir ./workflow    # load without installing
claude plugin validate ./workflow --strict
```

## Licence

MIT
