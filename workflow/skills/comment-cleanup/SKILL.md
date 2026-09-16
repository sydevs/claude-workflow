---
name: comment-cleanup
description: Apply the code-comments rule across a file, a directory or a whole repo — delete narration and change-narration, compress bloated rationale, and keep every comment that carries a real why. A comment-only editing pass, proved by comment-fingerprint.mjs. Use when asked to clean, prune, tidy or audit comments, or when a sweep ticket names a directory.
argument-hint: '[path] [--tier 1|2|3|5] [--dry-run]'
disable-model-invocation: true
effort: max
allowed-tools: Bash(*), Read, Edit, Grep, Glob
---

# Comment cleanup

A **comment-only** editing pass. Walk every comment in the target, keep the few that carry context
the code cannot, delete or compress the rest.

The rule this enforces is `docs/code-comments.md` in this repo, copied into each product repo at
`docs/rules/code-comments.md`. Read the target repo's copy first — it carries carve-outs this file
does not.

## How this differs from the review that already runs

`finalize-pr` step 2 runs `pr-review-toolkit`'s `comment-analyzer` over a branch diff. That reviews
one diff and reports. **This applies fixes, across files nobody is currently touching.** Do not run
this as a substitute for that review, and do not re-review a diff this skill just produced.

## Scope

**Edit comments only. Never change code in this pass.** No renames, no extractions, no logic
changes, not even an obvious one. Where a comment exists only because the code is unclear, the
comment survives — it is doing real work, badly — and the situation goes in the report as a flag.
A refactor is a different task with a different review.

Tidy whitespace a deletion leaves behind. The code itself must stay byte-identical.

## Run it through Bash, not Edit, for tiers 1 to 3

The workflow plugin fires `prettier-format.mjs` and `eslint-fix.mjs` as PostToolUse on the
`Edit|Write` **tools**. A codemod invoked from Bash trips neither. Under `Edit`, a SahajCloud sweep
is about 900 edits and about 1,800 hook processes, each spawning the package manager.

So: run the mechanical tiers as one script, then format once, deliberately, as its own commit,
scoped to changed files only. Never `lint --fix` repo-wide — that sweeps in unrelated pre-existing
fixes and contaminates a diff whose whole value is that it touched nothing else.

Tier 5 is the only tier that uses `Edit`, at low volume, where the hooks are fine.

## The pass — apply to every comment, in order

**1. Narration?** Restates the code, describes the step, restates a name, a type or a signature, or
marks a block end. → **Delete.** The code below it was fine all along. Do not touch it.

**2. Change narration?** Addressed to the reviewer of a diff rather than a reader of the file —
"updated to use the v2 client", "removed the old fallback", "as requested". → **Delete.** Test: would
this sentence make sense to someone reading the file fresh in a year who never saw a PR? If not, it
belonged in a commit message, and that commit already happened.

**3. Points at a moving target?** "See the spec", "per the requirements doc", and **any section
number of any document** — that is the canonical ephemeral form, whatever it indexes into. →
**Delete** if the line needed no comment at all, or **rewrite** to encode the substance. Durable and
fine as breadcrumbs: ticket IDs, RFCs, permalinks, and a maintained repo doc at a stable path.

**4. A *why* that is bloated or misplaced?** In sequence:

- *Does it belong in a doc?* System-level "why it is built this way" reads better in a maintained
  doc. If one already carries it, delete the inline copy and leave no signpost. If none exists, keep
  the comment and **flag it** — writing the doc is out of scope here.
- *Is all of it necessary?* Cut the mechanism the code already shows, where a value is consumed
  downstream, the consequence of the consequence, and the justification of the justification.
- *Does it belong in one block?* A long header covering several points usually serves better split,
  each part next to the line it governs. Proximity is what keeps a comment true.
- *Is the remaining length earned?* Some rationale is irreducibly multi-part. Length alone is not a
  defect. Unearned length is. Never shorten a comment at the cost of the information in it.

The trap this rule exists to catch: **"carries a real *why*" and "is worded minimally" are separate
judgements.** Passing the first does not exempt a comment from the second. Rank candidates with
`ste-lint.py --json` rather than reading everything — its long-sentence, nominalization and
passive-voice counts are good proxies for an essay.

**5. Stale?** Describes code that no longer exists. → **Delete**, or fix it if the point still
holds. A wrong comment is worse than no comment.

**6. None of the above?** → **Keep**, and do not reword a comment that is already tight. Churn on a
good comment is itself noise. But "already fine" means already minimal, not merely accurate.

**When in doubt about a *why*, keep it.** Wrongly deleting a real warning costs far more than
leaving one mediocre comment behind.

## Never delete

`workflow/lib/comment-protect.json` is the machine-readable list, and the verifier counts every
category before and after. Read it before you start. The categories:

- **Tool directives** — each changes what a compiler, linter, formatter or bundler does.
- **`⚠` lines** — this workspace's own load-bearing marker. 362 of them.
- **Cross-repo sync pointers** — "keep in sync", "must match", "source of truth", `<Repo>#NNN`.
  Nothing but prose enforces the couplings between these repos.
- **Issue breadcrumbs** — a `#NNN` carries evidence a compressed comment cannot.
- **Structural section banners** are navigation, not narration. Collapse a three-line banner to one
  line and keep the label. Never drop the label.

Three keep categories that read as deletable and are not: **cross-file consistency pointers** (the
link itself is the *why*), **data-literal semantics** (a literal cannot show its own units), and
**presentation contracts** (they pin output to an external expectation).

## Two traps in this workspace

- **`SahajAtlasWeb/src/lib/brand.test.ts` reads raw file text**, comments included, and fails if a
  visitor-facing brand name appears in seven named copy files. It fired once already, on a comment
  reflowed onto one line. Check proposed text against `textGuards` in
  `comment-protect.json` before writing. The hyphenated form is safe. The spaced form is not.
- **`jsx-sort-props` autofix moves props and leaves comments where they sat.** Lint stays green and
  the comment now documents its neighbour. Do not edit a comment inside a JSX opening element. Move
  it above the element first, as its own reviewed change.

## Prove it

Every commit, without exception:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/comment-fingerprint.mjs" --base <branch-point>
```

Run it **after** the format commit, so it proves the whole stack including the formatter. Read all
three outputs. `codeHash` alone proves only that no code changed — it passes a deleted
`prettier-ignore` and a displaced comment, which is why the census and the anchor check exist.

Then the repo's own lean gate, from `leanGate.command` in its `.claude/workflow.json`.

## Report

1. **Counts** — deleted, rewritten, kept, per file.
2. **The verifier's verdict**, pasted, not summarized.
3. **Flags** — comments papering over unclear code, deferral TODOs, comments you could not check and kept anyway.
4. **Judgement calls** — borderline keeps and deletes, one line each, so a reviewer can overrule.

Keep it brief. Do not list deleted narration. That is the point of the pass, not news.
